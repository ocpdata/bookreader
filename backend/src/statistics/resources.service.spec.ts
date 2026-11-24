import {
  BadRequestException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { AdminService } from '../auth/admin.service';
import { ResourcesService } from './resources.service';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-cloudwatch', () => {
  const sdk = jest.requireActual<typeof import('@aws-sdk/client-cloudwatch')>(
    '@aws-sdk/client-cloudwatch',
  );
  return {
    ...sdk,
    CloudWatchClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

describe('ResourcesService', () => {
  let service: ResourcesService;
  const requireAdmin = jest.fn();
  const config: Record<string, string> = {
    AWS_REGION: 'us-east-1',
    S3_BUCKET: 'bucket',
    MONITORING_INSTANCE_ID: 'i-test',
    MONITORING_DB_INSTANCE_ID: 'db-test',
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-23T12:00:00Z'));
    mockSend.mockReset();
    requireAdmin.mockReset().mockResolvedValue({});
    const module = await Test.createTestingModule({
      providers: [
        ResourcesService,
        { provide: AdminService, useValue: { requireAdmin } },
        {
          provide: ConfigService,
          useValue: { get: (name: string) => config[name] },
        },
      ],
    }).compile();
    service = module.get(ResourcesService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sums transfer intervals, retains missing metrics and caches authenticated queries', async () => {
    mockSend.mockImplementation(async (command: GetMetricDataCommand) => ({
      MetricDataResults: command.input.MetricDataQueries?.map((q) => ({
        Id: q.Id,
        StatusCode: 'Complete',
        Timestamps:
          q.Id === 'networkout'
            ? [
                new Date('2026-11-23T10:00:00Z'),
                new Date('2026-11-23T11:00:00Z'),
              ]
            : [],
        Values: q.Id === 'networkout' ? [100, 250] : [],
      })),
    }));
    const result = await service.get('admin', 'today');
    expect(result.start).toBe('2026-11-23T00:00:00.000Z');
    expect(result.metrics.networkout.value).toBe(350);
    expect(result.metrics.memory.value).toBeNull();
    expect((await service.get('admin', 'today')).generatedAt).toBe(
      result.generatedAt,
    );
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(requireAdmin).toHaveBeenCalledTimes(2);
    requireAdmin.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.get('user', 'today')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mockSend).toHaveBeenCalledTimes(2);
    const queries = (mockSend.mock.calls[0][0] as GetMetricDataCommand).input
      .MetricDataQueries;
    expect(
      queries?.find((item) => item.Id === 'downloaded')?.MetricStat?.Metric
        ?.Dimensions,
    ).toEqual([
      { Name: 'BucketName', Value: 'bucket' },
      { Name: 'FilterId', Value: 'bookreader-requests' },
    ]);
  });

  it('rejects unauthorized users and invalid periods before querying AWS', async () => {
    requireAdmin.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.get('user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.get('admin', 'invalid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not present a failed CloudWatch response as empty data', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(service.get('admin')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('coalesces concurrent requests for the same period', async () => {
    mockSend.mockResolvedValue({ MetricDataResults: [] });
    const [first, second] = await Promise.all([
      service.get('admin', 'week'),
      service.get('admin', 'week'),
    ]);
    expect(first).toEqual(second);
    expect(first.start).toBe('2026-11-17T00:00:00.000Z');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

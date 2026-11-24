import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CloudWatchClient,
  GetMetricDataCommand,
  type MetricDataQuery,
  type MetricDataResult,
} from '@aws-sdk/client-cloudwatch';
import { AdminService } from '../auth/admin.service';

type Period = 'today' | 'week' | 'month';
type Point = { timestamp: string; value: number };
type Metric = {
  value: number | null;
  timestamp: string | null;
  points: Point[];
};
type ResourceMetrics = {
  generatedAt: string;
  start: string;
  end: string;
  metrics: Record<string, Metric>;
};

const DAY = 86_400_000;
const CACHE_MS = 5 * 60_000;

@Injectable()
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);
  private readonly client: CloudWatchClient;
  private readonly cache = new Map<
    Period,
    { expires: number; data: ResourceMetrics }
  >();
  private readonly pending = new Map<Period, Promise<ResourceMetrics>>();

  constructor(
    private readonly config: ConfigService,
    private readonly admin: AdminService,
  ) {
    this.client = new CloudWatchClient({
      region: config.get<string>('AWS_REGION'),
    });
  }

  async get(actorId: string, requested?: string): Promise<ResourceMetrics> {
    await this.admin.requireAdmin(actorId);
    if (requested && !['today', 'week', 'month'].includes(requested)) {
      throw new BadRequestException('Período no válido');
    }
    const period = (requested || 'month') as Period;
    const cached = this.cache.get(period);
    if (cached && cached.expires > Date.now()) return cached.data;
    const existing = this.pending.get(period);
    if (existing) return existing;
    const task = this.load(period);
    this.pending.set(period, task);
    try {
      const data = await task;
      this.cache.set(period, { expires: Date.now() + CACHE_MS, data });
      return data;
    } finally {
      this.pending.delete(period);
    }
  }

  private async load(period: Period): Promise<ResourceMetrics> {
    const instance = this.config.get<string>('MONITORING_INSTANCE_ID');
    const db = this.config.get<string>('MONITORING_DB_INSTANCE_ID');
    const bucket = this.config.get<string>('S3_BUCKET');
    const region = this.config.get<string>('AWS_REGION');
    if (!instance || !db || !bucket || !region) {
      throw new ServiceUnavailableException(
        'El monitoreo de recursos no está configurado en este servidor',
      );
    }
    const end = new Date();
    const midnight = Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      end.getUTCDate(),
    );
    const start = new Date(
      midnight - (period === 'today' ? 0 : period === 'week' ? 6 : 29) * DAY,
    );
    const interval = period === 'today' ? 300 : 3600;
    const ec2 = [{ Name: 'InstanceId', Value: instance }];
    const rds = [{ Name: 'DBInstanceIdentifier', Value: db }];
    const s3 = [
      { Name: 'BucketName', Value: bucket },
      { Name: 'FilterId', Value: 'bookreader-requests' },
    ];
    const query = (
      id: string,
      namespace: string,
      name: string,
      dimensions: { Name: string; Value: string }[],
      stat: string,
      seconds = interval,
    ): MetricDataQuery => ({
      Id: id,
      MetricStat: {
        Metric: {
          Namespace: namespace,
          MetricName: name,
          Dimensions: dimensions,
        },
        Period: seconds,
        Stat: stat,
      },
      ReturnData: true,
    });
    const queries = [
      query('cpu', 'AWS/EC2', 'CPUUtilization', ec2, 'Average'),
      query('memory', 'CWAgent', 'mem_used_percent', ec2, 'Average'),
      query('disk', 'CWAgent', 'disk_used_percent', ec2, 'Average'),
      query('networkin', 'AWS/EC2', 'NetworkIn', ec2, 'Sum'),
      query('networkout', 'AWS/EC2', 'NetworkOut', ec2, 'Sum'),
      query('dbcpu', 'AWS/RDS', 'CPUUtilization', rds, 'Average'),
      query('dbfree', 'AWS/RDS', 'FreeStorageSpace', rds, 'Average'),
      query('dbconnections', 'AWS/RDS', 'DatabaseConnections', rds, 'Average'),
      query('uploaded', 'AWS/S3', 'BytesUploaded', s3, 'Sum'),
      query('downloaded', 'AWS/S3', 'BytesDownloaded', s3, 'Sum'),
    ];
    const storage = query(
      'storage',
      'AWS/S3',
      'BucketSizeBytes',
      [
        { Name: 'BucketName', Value: bucket },
        { Name: 'StorageType', Value: 'StandardStorage' },
      ],
      'Average',
      86400,
    );
    try {
      const [results, storageResults] = await Promise.all([
        this.fetch(queries, start, end),
        this.fetch([storage], new Date(end.getTime() - 3 * DAY), end),
      ]);
      const metrics: Record<string, Metric> = {};
      const sums = new Set([
        'networkin',
        'networkout',
        'uploaded',
        'downloaded',
      ]);
      for (const id of [...queries.map((q) => q.Id!), 'storage']) {
        const points = [...results, ...storageResults]
          .filter((result) => result.Id === id)
          .flatMap((result) =>
            (result.Timestamps ?? []).map((timestamp, index) => ({
              timestamp: timestamp.toISOString(),
              value: result.Values?.[index],
            })),
          )
          .filter(
            (point): point is Point =>
              typeof point.value === 'number' && Number.isFinite(point.value),
          )
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const last = points.at(-1);
        metrics[id] = {
          value: last
            ? sums.has(id)
              ? points.reduce((sum, point) => sum + point.value, 0)
              : last.value
            : null,
          timestamp: last?.timestamp ?? null,
          points,
        };
      }
      return {
        generatedAt: new Date().toISOString(),
        start: start.toISOString(),
        end: end.toISOString(),
        metrics,
      };
    } catch (error) {
      this.logger.error(
        'No se pudieron consultar las métricas de CloudWatch',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        'No se pudieron consultar las métricas de AWS. Revisa la configuración y los permisos.',
      );
    }
  }

  private async fetch(
    queries: MetricDataQuery[],
    start: Date,
    end: Date,
  ): Promise<MetricDataResult[]> {
    const results: MetricDataResult[] = [];
    let token: string | undefined;
    do {
      const response = await this.client.send(
        new GetMetricDataCommand({
          MetricDataQueries: queries,
          StartTime: start,
          EndTime: end,
          ScanBy: 'TimestampAscending',
          NextToken: token,
        }),
      );
      if (response.Messages?.length)
        throw new Error(`CloudWatch: ${JSON.stringify(response.Messages)}`);
      for (const result of response.MetricDataResults ?? []) {
        if (
          result.StatusCode !== 'Complete' &&
          !(result.StatusCode === 'PartialData' && response.NextToken)
        ) {
          throw new Error(`CloudWatch ${result.Id}: ${result.StatusCode}`);
        }
        results.push(result);
      }
      token = response.NextToken;
    } while (token);
    return results;
  }
}

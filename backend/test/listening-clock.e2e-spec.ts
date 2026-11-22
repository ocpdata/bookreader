import { ListeningClock } from '../../frontend/src/listeningClock';

describe('Reloj de escucha web', () => {
  it('solo cuenta tiempo reproduciendo, incluyendo repeticiones pero no pausas ni saltos', () => {
    const clock = new ListeningClock();
    clock.start(1000);
    expect(clock.collect(6000, true)).toEqual([5000]);
    expect(clock.collect(20000, true)).toEqual([]);
    clock.start(20000);
    expect(clock.collect(22000, true)).toEqual([2000]);
    clock.start(25000);
    expect(clock.collect(55000, false)).toEqual([30000]);
    expect(clock.collect(56000, true)).toEqual([1000]);
  });

  it('limita intervalos sin observación y no duplica guardados', () => {
    const clock = new ListeningClock();
    clock.start(0);
    clock.start(1000);
    expect(clock.collect(120000, false)).toEqual([60000]);
    expect(clock.collect(120000, true)).toEqual([]);
  });
});

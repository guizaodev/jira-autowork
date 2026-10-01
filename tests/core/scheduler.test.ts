import { describe, expect, test } from "bun:test";
import {
  createScheduler,
  DAILY_JOB_HOUR,
  DAILY_JOB_MINUTE,
  KEEPALIVE_INTERVAL_MINUTES,
} from "../../src/core/scheduler";
import type { Alerter, AlertPayload } from "../../src/core/alerter";
import type { Applier } from "../../src/core/applier";
import type { HolidayStore } from "../../src/core/holidays";
import type { KeepaliveProbe } from "../../src/core/jira";
import { emptyHolidaySet, makeTempDb } from "../helpers";

interface SchedulerHarness {
  probeQueue: KeepaliveProbe[];
  alerts: AlertPayload[];
  runNowCalls: () => number;
  holidayLoads: number[];
  holidayInvalidations: number[];
  start: () => void;
  stop: () => void;
  tickDaily: () => void;
  tickKeepalive: () => void;
  setNow: (date: Date) => void;
  cleanup: () => void;
}

function makeSchedulerHarness(): SchedulerHarness {
  const { db, cleanup } = makeTempDb();
  let now = new Date("2026-09-29T08:00:00-03:00");
  const probeQueue: KeepaliveProbe[] = [];
  const alerts: AlertPayload[] = [];
  let runNowCalls = 0;
  const holidayLoads: number[] = [];
  const holidayInvalidations: number[] = [];

  const applier: Applier = {
    async runNow() {
      runNowCalls++;
      return { ranAt: new Date().toISOString(), days: [] };
    },
  };
  const alerter: Alerter = {
    async sendAlert(payload) {
      alerts.push(payload);
    },
    async probeAndRecord() {
      return probeQueue.shift() ?? "alive";
    },
  };
  const holidays: HolidayStore = {
    async loadYear(year) {
      holidayLoads.push(year);
      return emptyHolidaySet(year);
    },
    invalidate(year) {
      holidayInvalidations.push(year);
    },
  };

  let dailyCb: (() => void) | null = null;
  let keepaliveCb: (() => void) | null = null;
  const setIntervalFn = ((cb: () => void, ms: number) => {
    if (ms === 60_000) dailyCb = cb;
    if (ms === KEEPALIVE_INTERVAL_MINUTES * 60_000) keepaliveCb = cb;
    return 0 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;

  const scheduler = createScheduler({
    db,
    applier,
    alerter,
    holidays,
    now: () => now,
    setIntervalFn,
    clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
  });

  return {
    probeQueue,
    alerts,
    runNowCalls: () => runNowCalls,
    holidayLoads,
    holidayInvalidations,
    start: () => scheduler.start(),
    stop: () => scheduler.stop(),
    tickDaily: () => dailyCb?.(),
    tickKeepalive: () => keepaliveCb?.(),
    setNow: (date: Date) => {
      now = date;
    },
    cleanup,
  };
}

describe("scheduler / job diário 09:05", () => {
  test("constantes do job e keepalive", () => {
    expect(DAILY_JOB_HOUR).toBe(9);
    expect(DAILY_JOB_MINUTE).toBe(5);
    expect(KEEPALIVE_INTERVAL_MINUTES).toBe(20);
  });

  test("roda no boot e refaz apenas uma vez por dia, a partir de 09:05", async () => {
    const h = makeSchedulerHarness();
    try {
      h.start();
      await Bun.sleep(10);
      expect(h.runNowCalls()).toBe(1);

      h.tickDaily();
      await Bun.sleep(10);
      expect(h.runNowCalls()).toBe(1);

      h.setNow(new Date("2026-09-30T09:04:00-03:00"));
      h.tickDaily();
      await Bun.sleep(10);
      expect(h.runNowCalls()).toBe(1);

      h.setNow(new Date("2026-09-30T09:05:00-03:00"));
      h.tickDaily();
      await Bun.sleep(10);
      expect(h.runNowCalls()).toBe(2);
      h.tickDaily();
      await Bun.sleep(10);
      expect(h.runNowCalls()).toBe(2);
    } finally {
      h.stop();
      h.cleanup();
    }
  });

  test("refresh de feriados no boot", async () => {
    const h = makeSchedulerHarness();
    try {
      h.start();
      await Bun.sleep(10);
      expect(h.holidayLoads).toContain(2026);
    } finally {
      h.stop();
      h.cleanup();
    }
  });

  test("P2-8 catch-up no boot não marca o dia — 09:05 do mesmo dia ainda roda", async () => {
    const h = makeSchedulerHarness();
    try {
      h.setNow(new Date("2026-09-30T08:55:00-03:00"));
      h.start();
      await Bun.sleep(10);
      expect(h.runNowCalls()).toBe(1);

      h.setNow(new Date("2026-09-30T09:05:00-03:00"));
      h.tickDaily();
      await Bun.sleep(10);
      expect(h.runNowCalls()).toBe(2);

      h.tickDaily();
      await Bun.sleep(10);
      expect(h.runNowCalls()).toBe(2);
    } finally {
      h.stop();
      h.cleanup();
    }
  });

  test("P2-8 virada de mês invalida cache e recarrega feriados do novo ano", async () => {
    const h = makeSchedulerHarness();
    try {
      h.setNow(new Date("2026-12-31T10:00:00-03:00"));
      h.start();
      await Bun.sleep(10);
      expect(h.holidayLoads).toContain(2026);

      h.setNow(new Date("2027-01-01T00:01:00-03:00"));
      h.tickDaily();
      await Bun.sleep(10);
      expect(h.holidayLoads).toContain(2027);
      expect(h.holidayInvalidations).toContain(2027);
    } finally {
      h.stop();
      h.cleanup();
    }
  });
});

describe("scheduler / keepalive e alerta webhook 1x", () => {
  test("sessão morta alerta 1x até voltar; retorno confirma e reseta", async () => {
    const h = makeSchedulerHarness();
    try {
      h.probeQueue.push("dead", "dead", "dead", "alive", "dead");
      h.start();
      await Bun.sleep(10);
      expect(h.alerts.filter((a) => a.text.includes("expirada"))).toHaveLength(
        1,
      );

      h.tickKeepalive();
      h.tickKeepalive();
      await Bun.sleep(0);
      expect(h.alerts.filter((a) => a.text.includes("expirada"))).toHaveLength(
        1,
      );

      h.tickKeepalive();
      await Bun.sleep(0);
      expect(
        h.alerts.filter((a) => a.text.includes("restabelecida")),
      ).toHaveLength(1);

      h.tickKeepalive();
      await Bun.sleep(0);
      expect(h.alerts.filter((a) => a.text.includes("expirada"))).toHaveLength(
        2,
      );
    } finally {
      h.cleanup();
    }
  });

  test("network-error (5xx/rede) não alerta", async () => {
    const h = makeSchedulerHarness();
    try {
      h.probeQueue.push("network-error", "network-error");
      h.start();
      h.tickKeepalive();
      await Bun.sleep(10);
      expect(h.alerts).toHaveLength(0);
    } finally {
      h.stop();
      h.cleanup();
    }
  });
});

describe("scheduler / disposição", () => {
  test("stop limpa os timers sem lançar", async () => {
    const h = makeSchedulerHarness();
    try {
      h.start();
      await Bun.sleep(10);
      expect(() => h.stop()).not.toThrow();
    } finally {
      h.cleanup();
    }
  });
});

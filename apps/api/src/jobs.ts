import { accessEndingJob, notificationPurgeJob } from './modules/access';
import { subscriptionLifecycleJob } from './modules/billing';
import { purgeEndedSessionTokens } from './modules/identity';
import { RegistrationContext, runRegistrationMaintenance } from './modules/registration';
import { botCheckFor } from './platform/bot-check';
import { FileStorageService } from './platform/file-storage';
import { JobRunner, NO_WORK, type ScheduledJob } from './platform/jobs';
import { workforceExpiryJob } from './modules/workforce';
import { actionDueJob } from './modules/action';
import { syncMaintenanceJob } from './modules/sync';

/**
 * The daily jobs, in the order they run (PLT-09, T-25). Each one is independent: a failure is
 * recorded in `job_run` and the next job still runs.
 */
const DAILY_JOBS: readonly ScheduledJob[] = [
  {
    name: 'sessions.purge',
    async run({ db, logger }) {
      await purgeEndedSessionTokens(db, logger);
      return NO_WORK;
    },
  },
  {
    name: 'files.purge',
    async run({ db, env, clock }) {
      const purged = await new FileStorageService(db, env.FILES, clock).purgeDeletedFiles();
      return { processed: purged, changed: purged, failed: 0 };
    },
  },
  {
    name: 'registrations.maintenance',
    async run({ db, env, config, logger, clock, runId }) {
      const result = await runRegistrationMaintenance(
        new RegistrationContext({
          db,
          config,
          meta: { requestId: runId, ipAddress: null, userAgent: null },
          logger,
          queue: env.JOBS,
          cache: env.CACHE,
          botCheck: botCheckFor(config),
          clock,
        }),
      );
      const changed = result.removedUnverified + result.closedRejected;
      return { processed: changed, changed, failed: 0 };
    },
  },
  subscriptionLifecycleJob,
  // Sprint 6
  accessEndingJob,
  notificationPurgeJob,
  // Sprint 7
  workforceExpiryJob,
  // Sprint 8
  actionDueJob,
  // Sprint 9
  syncMaintenanceJob,
];

export const dailyJobs = new JobRunner(DAILY_JOBS);

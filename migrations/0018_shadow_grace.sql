-- Shadow checks pause briefly after a library change: the old path reshuffles
-- mid-song while the log only changes from its next item boundary.
ALTER TABLE sched_channels ADD COLUMN shadow_grace_until_ms INTEGER;

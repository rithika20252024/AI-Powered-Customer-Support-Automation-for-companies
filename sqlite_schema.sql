-- ABC Technologies Customer Support System
-- SQLite Memory Schema (managed by LangGraph SqliteSaver)
-- File: memory.db  (auto-created at runtime)

-- Stores full graph state snapshots per customer session
CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id       TEXT NOT NULL,         -- customer_id (e.g. CUST_001)
    checkpoint_ns   TEXT NOT NULL,         -- namespace (default: "")
    checkpoint_id   TEXT NOT NULL,         -- unique checkpoint UUID
    parent_checkpoint_id TEXT,             -- parent for rollback/replay
    type            TEXT,                  -- serialisation format
    checkpoint      BLOB NOT NULL,         -- serialised SupportState snapshot
    metadata        BLOB NOT NULL,         -- LangGraph metadata (step count etc.)
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

-- Stores intermediate node write operations for crash recovery
CREATE TABLE IF NOT EXISTS writes (
    thread_id       TEXT NOT NULL,
    checkpoint_ns   TEXT NOT NULL,
    checkpoint_id   TEXT NOT NULL,
    task_id         TEXT NOT NULL,
    idx             INTEGER NOT NULL,
    channel         TEXT NOT NULL,         -- state field name (e.g. "messages")
    type            TEXT,
    value           BLOB,                  -- serialised field value
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

-- Example: Query stored conversations for a customer
-- SELECT thread_id, checkpoint_id FROM checkpoints WHERE thread_id = 'CUST_001';

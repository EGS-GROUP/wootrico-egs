-- Binary store for the "local" media driver (kept in Postgres so the library
-- needs no shared filesystem volume between the panel and worker containers).
CREATE TABLE "media_blobs" (
    "storage_key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_blobs_pkey" PRIMARY KEY ("storage_key")
);

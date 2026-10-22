# Redis Operations

## Configuration

Redis is configured with **AOF (Append Only File)** persistence and **RDB snapshots**
to prevent data loss of OTP codes, job queues, and rate-limit state on restart.

### Persistence settings

| Setting          | Value            | Reason                                                             |
| ---------------- | ---------------- | ------------------------------------------------------------------ |
| `appendonly`     | `yes`            | Enables AOF persistence                                            |
| `appendfsync`    | `everysec`       | Flushes to disk every second — balances durability and performance |
| `appendfilename` | `appendonly.aof` | AOF file name                                                      |
| `dir`            | `/data`          | Persistent volume mount point                                      |
| `save 3600 1`    | RDB snapshot     | Write RDB if ≥1 key changed in 1 hour                              |
| `save 300 100`   | RDB snapshot     | Write RDB if ≥100 keys changed in 5 minutes                        |
| `save 60 10000`  | RDB snapshot     | Write RDB if ≥10 000 keys changed in 1 minute                      |

### Why both AOF and RDB?

AOF provides near-real-time durability (at most 1 second of data loss); RDB provides
compact recovery snapshots. Using both gives a fast startup path from RDB and
fine-grained recovery from AOF.

## Replication

### Local / development

`docker-compose.yml` defines a `redis-replica` service that automatically follows
the primary (`redis`) using `--replicaof redis 6379`. It is exposed on port **6380**.

```bash
# Start both primary and replica
docker compose up -d redis redis-replica

# Verify replication is running
docker compose exec redis-replica redis-cli info replication
# Expected: role:slave, master_link_status:up
```

### Production

Configure **at least one managed replica** via your cloud provider:

| Provider    | Option                                   |
| ----------- | ---------------------------------------- |
| AWS         | ElastiCache Multi-AZ with auto-failover  |
| GCP         | Memorystore with read replica            |
| Upstash     | Multi-region replication                 |
| Self-hosted | Redis Sentinel (≥1 sentinel, ≥1 replica) |

Set the `REDIS_URL` env var to the primary endpoint. If your provider gives you a
read-replica URL for offloading reads (e.g., rate-limit counters), set
`REDIS_READ_URL` accordingly.

## Running locally

```bash
docker compose up -d redis redis-replica
```

Primary: `redis://localhost:6379`  
Replica: `redis://localhost:6380`

## Failover testing procedure

Use this procedure to test that failover works before it happens in production.

### 1. Verify replication is healthy

```bash
docker compose exec redis redis-cli info replication
# Expect: connected_slaves:1
docker compose exec redis-replica redis-cli info replication
# Expect: role:slave, master_link_status:up
```

### 2. Simulate primary failure

```bash
# Kill the primary container
docker compose stop redis

# Verify the replica is still responding
docker compose exec redis-replica redis-cli ping
# Expected: PONG
```

### 3. Promote replica to primary (manual, for self-hosted Redis)

```bash
docker compose exec redis-replica redis-cli replicaof no one
# Verify it is now primary
docker compose exec redis-replica redis-cli info replication
# Expect: role:master
```

Update `REDIS_URL` to point to the promoted replica endpoint.

### 4. Restart original primary as a new replica (optional)

```bash
docker compose start redis
docker compose exec redis redis-cli replicaof redis-replica 6379
```

### 5. Restore original topology

```bash
docker compose exec redis redis-cli replicaof no one
docker compose exec redis-replica redis-cli replicaof redis 6379
```

> **Note**: Managed providers (ElastiCache, Upstash) handle promotion automatically.
> You only need to update `REDIS_URL` if the primary endpoint changes.

## Recovery procedure

If Redis data is lost or corrupted:

1. **Stop the application** to prevent new jobs from being enqueued.

2. **Check AOF file integrity:**

   ```bash
   docker compose exec redis redis-check-aof /data/appendonly.aof
   ```

   If corrupted, repair it:

   ```bash
   docker compose exec redis redis-check-aof --fix /data/appendonly.aof
   ```

3. **Restart Redis** — it will replay the AOF log automatically:

   ```bash
   docker compose restart redis
   ```

4. **Verify queued jobs** are restored, then restart the application.

5. **For total data loss** (no AOF file): queued unlock jobs must be reconstructed
   from the PostgreSQL `gifts` table. Query for gifts with `status = 'locked'` and
   `unlock_at > NOW()` and re-enqueue them manually.

## Monitoring

Check persistence and replication health in one command:

```bash
docker compose exec redis redis-cli info all | grep -E \
  "aof_enabled|aof_last_bgrewrite_status|rdb_last_bgsave_status|connected_slaves|master_link_status"
```

Expected output:

```
aof_enabled:1
aof_last_bgrewrite_status:ok
rdb_last_bgsave_status:ok
connected_slaves:1            # (primary only)
master_link_status:up         # (replica only)
```

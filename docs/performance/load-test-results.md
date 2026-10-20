# Load Test Results

> **Tool:** [k6](https://k6.io)
> **Scripts:** `load-tests/gift-creation.k6.js`, `load-tests/gift-claim.k6.js`, `load-tests/combined.k6.js`

---

## Capacity Targets

These targets define the minimum acceptable performance under the projected peak load.
All scaling and infrastructure decisions must be validated against them.

| Scenario        | Virtual Users | Duration | Target Throughput | p95 Latency | Max Error Rate |
| --------------- | ------------- | -------- | ----------------- | ----------- | -------------- |
| Gift creation   | 100           | 30 s     | ≥ 50 req/s        | < 2 000 ms  | < 1%           |
| Gift claim      | 50            | 30 s     | ≥ 25 req/s        | < 3 000 ms  | < 1%           |
| Combined (both) | 150           | 30 s     | ≥ 60 req/s total  | see above   | < 1%           |

**Rationale:**

- Gift creation latency budget (2 s) accounts for a DB write, Paystack API round-trip, and Redis queue push.
- Claim latency budget (3 s) accounts for the Stellar transaction submission, which adds 1–2 s on testnet.
- Error rate ≤ 1% aligns with the application's SLO for payment-critical flows.

---

## Scaling Thresholds

Breach of any threshold below is a trigger to scale the relevant layer **before** the next traffic spike.

| Metric breached                         | Layer to scale                                               | Action                                                        |
| --------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `gift_creation_duration` p95 > 2 000 ms | Database — likely connection pool saturation                 | Increase `DB_POOL_MAX`; upgrade RDS instance class            |
| `gift_claim_duration` p95 > 3 000 ms    | Stellar RPC or App Runner compute                            | Upgrade RPC endpoint tier; increase App Runner CPU/memory     |
| `http_req_failed` rate > 0.5%           | App Runner — likely instance count or concurrency exhaustion | Scale App Runner max concurrency; add auto-scaling policy     |
| Redis `BUSY` errors appear in logs      | Redis — queue backpressure                                   | Upgrade ElastiCache node type; tune worker concurrency        |
| Paystack webhook delays > 5 s           | Paystack provider backpressure                               | Implement exponential backoff; alert ops; add circuit breaker |

**How to monitor in real time:**

```bash
# Watch k6 metrics live during a run
k6 run load-tests/combined.k6.js \
  --out influxdb=http://localhost:8086/k6   # if InfluxDB+Grafana is running

# Or write JSON for offline analysis
k6 run load-tests/combined.k6.js \
  --out json=load-tests/results/run-$(date +%s).json
```

---

## Performance Regression Thresholds (CI gates)

These thresholds are enforced by k6 and will cause a non-zero exit code (CI failure) if breached.

| Metric                       | Threshold  | Rationale                                           |
| ---------------------------- | ---------- | --------------------------------------------------- |
| `gift_creation_duration` p95 | < 2 000 ms | Gift creation involves DB write + Paystack API call |
| `gift_claim_duration` p95    | < 3 000 ms | Claim involves Stellar transaction submission       |
| `gift_creation_errors`       | < 1%       | Error rate budget                                   |
| `gift_claim_errors`          | < 1%       | Error rate budget                                   |
| `http_req_failed`            | < 1%       | Overall HTTP failure rate                           |

---

## Baseline Run — Not Yet Established

> **Status:** Baseline metrics have not yet been captured against a live environment.
> Run the scripts against a staging environment and record results in the table below.

### How to run

```bash
# 1. Start the app (or point at staging)
npm run dev   # or set BASE_URL=https://staging.lumigift.com

# 2. Obtain a valid auth token (NextAuth session JWT)
export AUTH_TOKEN="<your-jwt>"

# 3. (For claim tests) seed unlocked gift IDs
export GIFT_IDS="uuid1,uuid2,...,uuid50"
export STELLAR_KEY="G..."

# 4. Run combined test and save JSON output
k6 run load-tests/combined.k6.js \
  --out json=load-tests/results/baseline-$(date +%Y%m%d).json

# 5. View summary
k6 run load-tests/combined.k6.js --summary-export=load-tests/results/summary.json
```

---

## Baseline Results Template

Fill in after the first run against staging.

### Gift Creation (100 VUs, 30 s)

| Metric             | Value |
| ------------------ | ----- |
| Total requests     | —     |
| Throughput (req/s) | —     |
| p50 latency        | — ms  |
| p95 latency        | — ms  |
| p99 latency        | — ms  |
| Error rate         | — %   |
| Date               | —     |
| Environment        | —     |

### Gift Claim (50 VUs, 30 s)

| Metric             | Value |
| ------------------ | ----- |
| Total requests     | —     |
| Throughput (req/s) | —     |
| p50 latency        | — ms  |
| p95 latency        | — ms  |
| p99 latency        | — ms  |
| Error rate         | — %   |
| Date               | —     |
| Environment        | —     |

---

## CI Integration

Add the following step to `.github/workflows/ci.yml` once a staging environment is available.
k6 exits with code 1 if any threshold is breached, which will fail the CI job.

```yaml
load-test:
  name: Load Tests (staging)
  runs-on: ubuntu-latest
  needs: [build]
  if: github.ref == 'refs/heads/develop' || github.ref == 'refs/heads/main'
  environment: staging
  steps:
    - uses: actions/checkout@v4

    - name: Install k6
      run: |
        sudo gpg -k
        sudo gpg --no-default-keyring \
          --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
          --keyserver hkp://keyserver.ubuntu.com:80 \
          --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
        echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
          | sudo tee /etc/apt/sources.list.d/k6.list
        sudo apt-get update
        sudo apt-get install -y k6

    - name: Run load tests against staging
      env:
        BASE_URL: ${{ secrets.STAGING_APP_URL }}
        AUTH_TOKEN: ${{ secrets.STAGING_LOAD_TEST_AUTH_TOKEN }}
        GIFT_IDS: ${{ secrets.STAGING_LOAD_TEST_GIFT_IDS }}
        STELLAR_KEY: ${{ secrets.STAGING_LOAD_TEST_STELLAR_KEY }}
      run: |
        k6 run load-tests/combined.k6.js \
          --out json=load-tests/results/ci-${{ github.run_id }}.json

    - name: Upload results as artifact
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: load-test-results-${{ github.run_id }}
        path: load-tests/results/
        retention-days: 30
```

**Required secrets for CI load tests** (add to the `staging` environment in GitHub Settings):

| Secret                          | Description                                    |
| ------------------------------- | ---------------------------------------------- |
| `STAGING_LOAD_TEST_AUTH_TOKEN`  | Valid NextAuth JWT for the staging environment |
| `STAGING_LOAD_TEST_GIFT_IDS`    | Comma-separated pre-seeded unlocked gift UUIDs |
| `STAGING_LOAD_TEST_STELLAR_KEY` | Recipient Stellar public key for claim tests   |

---

## Notes

- The claim endpoint requires pre-seeded gifts with `status = "unlocked"`. In CI, a seed script should create these before the load test runs (`npm run db:seed:test`).
- Stellar transaction submission latency varies by network congestion. The 3 s p95 threshold is calibrated for testnet; production mainnet may be faster.
- Results JSON files in `load-tests/results/` are gitignored — they are uploaded as CI artifacts instead.
- Re-run baseline tests after any RDS instance class change, pool size change, or App Runner concurrency adjustment.

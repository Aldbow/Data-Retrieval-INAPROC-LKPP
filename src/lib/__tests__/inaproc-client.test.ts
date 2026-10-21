import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import {
    ApiError,
    RETRY,
    UpstreamUnavailableError,
    describeFailure,
    fetchPage,
} from '../inaproc-client.ts';

const ENDPOINT = '/v1/rup/master-satker';

const realFetch = globalThis.fetch;
const realDelay = RETRY.initialDelayMs;
const realToken = process.env.JWT_TOKEN;

/** Answers each call with the next status in `statuses`, counting the calls. */
function stubFetch(statuses: number[]): { calls: () => number } {
    let calls = 0;
    globalThis.fetch = (async () => {
        const status = statuses[Math.min(calls, statuses.length - 1)];
        calls++;
        const body = status === 200
            ? JSON.stringify({ success: true, data: [{ kode_satker: 'A' }], meta: { has_more: false } })
            : '<html>Service Unavailable</html>';
        return new Response(body, { status });
    }) as typeof fetch;
    return { calls: () => calls };
}

describe('fetchPage retry', () => {
    before(() => {
        process.env.JWT_TOKEN = 'test-token';
        RETRY.initialDelayMs = 1;
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    after(() => {
        RETRY.initialDelayMs = realDelay;
        if (realToken === undefined) delete process.env.JWT_TOKEN;
        else process.env.JWT_TOKEN = realToken;
    });

    // Observed 2026-10-21: short 503 spells that cleared within minutes.
    it('rides out a brief 503 spell', async () => {
        const stub = stubFetch([503, 503, 503, 200]);

        const page = await fetchPage(ENDPOINT, { year: '2026', limit: 100 });

        assert.deepEqual(page.rows, [{ kode_satker: 'A' }]);
        assert.equal(stub.calls(), 4);
    });

    it('gives up after every attempt fails, as an UpstreamUnavailableError', async () => {
        const stub = stubFetch([503]);

        await assert.rejects(fetchPage(ENDPOINT, { year: '2026', limit: 100 }), (error: unknown) => {
            assert.ok(error instanceof UpstreamUnavailableError);
            assert.equal(error.status, 503);
            assert.match(error.userMessage, /HTTP 503/);
            return true;
        });
        assert.equal(stub.calls(), RETRY.maxAttempts);
    });

    it('does not retry a non-transient status', async () => {
        const stub = stubFetch([404]);

        await assert.rejects(fetchPage(ENDPOINT, { year: '2026', limit: 100 }), (error: unknown) => {
            assert.ok(error instanceof ApiError);
            assert.ok(!(error instanceof UpstreamUnavailableError));
            assert.equal(error.status, 404);
            return true;
        });
        assert.equal(stub.calls(), 1);
    });

    it('reports a network failure as unreachable', async () => {
        globalThis.fetch = (async () => {
            throw new TypeError('fetch failed');
        }) as typeof fetch;

        await assert.rejects(fetchPage(ENDPOINT, { year: '2026' }), (error: unknown) => {
            assert.ok(error instanceof UpstreamUnavailableError);
            assert.match(error.userMessage, /tidak dapat dihubungi/);
            return true;
        });
    });
});

describe('describeFailure', () => {
    it('passes an outage through as 503 with its own message', () => {
        const error = new UpstreamUnavailableError('Upstream returned 503', 503, 'Server sedang tidak tersedia');

        assert.deepEqual(describeFailure(error, 'fallback'), { status: 503, message: 'Server sedang tidak tersedia' });
    });

    // A missing JWT_TOKEN is our configuration, not the API's outage.
    it('keeps a configuration error as 500 with the fallback message', () => {
        assert.deepEqual(describeFailure(new ApiError('JWT_TOKEN is not configured', 500), 'fallback'), {
            status: 500,
            message: 'fallback',
        });
    });

    it('never echoes an unexpected error message to the browser', () => {
        assert.deepEqual(describeFailure(new Error('EPERM: open DATA/x.json'), 'fallback'), {
            status: 502,
            message: 'fallback',
        });
    });
});

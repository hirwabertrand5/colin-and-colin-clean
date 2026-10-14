// Local shim: this sandbox blocks DNS for *.mongodb.net (SRV + A refused), but
// TCP egress to the Atlas shards on 27017 is allowed. We resolve the shard IPs
// once via DNS-over-HTTPS (cloudflare-dns.com, which IS reachable) and patch
// Node's dns.lookup to answer for those hostnames. Mongoose then validates TLS
// against the real hostnames (SNI/cert) while connecting to the correct IPs.
import dns from 'dns';

const SHARD_IPS: Record<string, string> = {
  'ac-uitoomc-shard-00-00.f5g0wlj.mongodb.net': '159.41.207.125',
  'ac-uitoomc-shard-00-01.f5g0wlj.mongodb.net': '159.41.207.147',
  'ac-uitoomc-shard-00-02.f5g0wlj.mongodb.net': '159.41.207.136',
  // Cluster hostname used by the driver during replica-set discovery.
  'cluster0.f5g0wlj.mongodb.net': '159.41.207.125',
};

const originalLookup = dns.lookup;

// @ts-expect-error - override with a compatible-but-broadened signature
dns.lookup = (hostname: string, options: any, callback?: any) => {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options || {};
  const ip = SHARD_IPS[hostname];
  if (ip) {
    const family = Number(opts?.family ?? 4) === 6 ? 6 : 4;
    const addr = { address: ip, family: 4 };
    if (opts && (opts.all || opts.returnAll)) return cb(null, [addr]);
    return cb(null, ip, 4);
  }
  // eslint-disable-next-line prefer-rest-params
  return (originalLookup as any).apply(dns, [hostname, options, callback]);
};

export {};

const dns = require('dns').promises;

(async () => {
  try {
    const res = await dns.resolveSrv('_mongodb._tcp.cluster0.f5g0wlj.mongodb.net');
    console.log('SRV result:', res);
  } catch (err) {
    console.error('SRV error:', err);
    process.exitCode = 1;
  }
})();

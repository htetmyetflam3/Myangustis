export function headerCheck(req, res, next) {
  const userAgent = req.headers['user-agent'];
  if (!userAgent || typeof userAgent !== 'string' || userAgent.length < 5) {
    return res
      .status(400)
      .json({ status: 'rejected', reason: 'Missing or invalid User-Agent' });
  }
  const botPattern = /curl|wget|python|scrapy|bot|crawler|spider|headless/i;
  if (botPattern.test(userAgent)) {
    return res
      .status(403)
      .json({ status: 'rejected', reason: 'Automated access denied' });
  }
  req.trustedIp =
    req.edge?.ip || req.ip || req.socket?.remoteAddress || 'unknown';
  const requireMyanmar = process.env.REQUIRE_MM_COUNTRY === 'true';
  if (requireMyanmar) {
    const country = req.edge?.country;
    if (country !== 'MM') {
      return res
        .status(403)
        .json({ status: 'rejected', reason: 'Access restricted to Myanmar' });
    }
  }
  next();
}

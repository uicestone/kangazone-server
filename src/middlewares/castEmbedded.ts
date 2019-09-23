export default async function(req, res, next) {
  for (let key in req.body) {
    if (
      req.body[key] instanceof Object &&
      ["code", "store", "user", "customer"].includes(key) &&
      req.body[key].id
    ) {
      req.body[key] = req.body[key].id;
    }
    if (["payments", "codes"].includes(key) && Array.isArray(req.body[key])) {
      req.body[key] = req.body[key].map(item => item.id || item);
    }
  }
  next();
}

export default items => {
  return items.reduce((acc, cur) => {
    const curObj = cur.toObject();
    ["_id", "__v", "createdAt", "updatedAt"].forEach(k => {
      delete curObj[k];
    });
    return Object.assign(acc, curObj);
  }, {});
};

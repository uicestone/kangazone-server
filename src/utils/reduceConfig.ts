export default items => {
  return items.reduce((acc, cur) => {
    const curObj = cur.toObject();
    ["_id", "__v", "createdAt", "updatedAt"].forEach(k => {
      curObj[k] = undefined;
    });
    return Object.assign(acc, curObj);
  }, {});
};

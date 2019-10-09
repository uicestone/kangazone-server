// remove broken booking.payments ref and isolated payments
const bpids = [];
db.bookings.find().forEach(b => {
  const paymentsWere = b.payments.length;
  b.payments = b.payments.filter(pid => {
    const p = db.payments.findOne({ _id: pid });
    if (!p) {
      print(`payment ${pid} in booking ${b._id} not exists will be removed.`);
      return false;
    }
    bpids.push(pid.toString());
    return true;
  });
  const paymentsNow = b.payments.length;
  if (paymentsNow < paymentsWere) {
    db.bookings.save(b);
    print(`booking ${b._id} payment id ${paymentsWere} -> ${paymentsNow}.`);
  }
});
db.payments.find({ attach: /^booking/ }).forEach(p => {
  if (!bpids.includes(p._id.toString())) {
    db.payments.remove({ _id: p._id });
    print(`payment ${p._id} not used by any booking, removed.`);
  }
});

// get gate pass stats of today
const date = new Date().toISOString().substr(0, 10);
const total = db.bookings.find({ date }).count();
const passed = db.bookings.find({ date, "passLogs.allow": true }).count();
const blocked = db.bookings.find({ date, "passLogs.allow": false }).count();
const blockNoPass = db.bookings
  .find({
    date,
    "passLogs.allow": false,
    $where: "this.passLogs.filter(p=>p.allow).length==0"
  })
  .count();
[
  { label: "全部订单", count: total },
  {
    label: "有成功通过记录的",
    count: passed,
    percent: ((passed / total) * 100).toFixed(2) + "%"
  },
  {
    label: "有拦截记录的",
    count: blocked,
    percent: ((blocked / total) * 100).toFixed(2) + "%"
  },
  {
    label: "只有拦截记录的",
    count: blockNoPass,
    percent: ((blockNoPass / total) * 100).toFixed(2) + "%"
  }
];

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

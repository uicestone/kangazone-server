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

// find deposit payment that cannot attach to a customer
db.payments.find({ attach: /^deposit/ }).forEach(p => {
  const c = db.users.findOne({ _id: p.customer });
  if (!c) {
    print(`Payment ${p._id}: customer not found.`);
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

// check unexpectedly used codes
db.bookings
  .find({ code: { $ne: null }, status: { $in: ["PENDING", "CANCELED"] } })
  .forEach(booking => {
    const code = db.codes.findOne({ _id: booking.code });
    if (code.used) {
      throw `booking not paid but code used: ${booking._id} ${code._id}`;
    }
  });

// set used code 'usedAt' and 'usedInBooking', create code payment in booking
db.bookings
  .find({
    code: { $ne: null },
    status: { $in: ["BOOKED", "IN_SERVICE", "FINISHED", "PENDING_REFUND"] }
  })
  .forEach(booking => {
    const code = db.codes.findOne({ _id: booking.code });
    if (!code.used) {
      throw `booking paid but code not used: ${booking._id} ${code._id}`;
    }
    db.codes.update(
      { _id: code._id },
      {
        $set: {
          usedAt: booking.createdAt,
          usedInBooking: booking._id
        }
      }
    );
    print(`code ${code._id} set usedAt and usedInBooking`);
    const paymentData = {
      paid: true,
      title: `预定南京砂之船店 ${booking.date} ${
        booking.hours ? booking.hours + "小时" : "畅玩"
      } ${booking.checkInAt}入场`,
      customer: booking.customer,
      amount: code.amount || 0,
      attach: `booking ${booking._id + ""}`,
      gateway: "credit",
      gatewayData: { bookingId: booking._id, codeId: code._id },
      updatedAt: new Date(),
      createdAt: booking.createdAt
    };
    const { insertedId: paymentId } = db.payments.insertOne(paymentData);
    if (!booking.payments || !booking.payments.push) {
      throw "booking payments null";
    }
    db.bookings.update(
      { _id: booking._id },
      { $push: { payments: paymentId } }
    );
    print("inserted payment", paymentData);
  });

// bulk update user code amount
db.users.find({ $where: "this.codes && this.codes.length > 0" }).forEach(u => {
  const codes = u.codes
    .map(cid => db.codes.findOne({ _id: cid }))
    .filter(c => !c.used);
  const codeAmount = codes.reduce((s, c) => s + (c.amount || 0), 0);
  db.users.update({ _id: u._id }, { $set: { codeAmount } });
  print(`${u.mobile} ${u.codeAmount} -> ${codeAmount}`);
});

// set user cardType
const cardTypes = { "680": "10次亲子" };
db.configs
  .findOne({ depositLevels: { $exists: true } })
  .depositLevels.forEach(l => {
    cardTypes[l.price] = l.cardType;
  });

db.payments
  .find({ attach: /deposit /, paid: true, amount: { $gt: 1 } })
  .forEach(p => {
    const cardType = cardTypes[p.amount];
    if (!cardType) {
      throw `Invalid price ${p.amount}`;
    }
    db.users.update({ _id: p.customer }, { $set: { cardType } });
    print(`${p.customer} set to ${cardType}`);
  });

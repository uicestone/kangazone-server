import handleAsyncErrors from "../utils/handleAsyncErrors";
import moment from "moment";
import HttpError from "../utils/HttpError";
import EscPosEncoder from "esc-pos-encoder-canvas";
import User from "../models/User";
import getStats from "../utils/getStats";
import { Gateways } from "../models/Payment";
import { Image } from "canvas";
import XlsxPopulate from "xlsx-populate";

moment.locale("zh-cn");

export default router => {
  // Store CURD
  router.route("/stats/:date?").get(
    handleAsyncErrors(async (req, res) => {
      const dateInput = req.params.date;
      const stats = await getStats(dateInput);
      res.json(stats);
    })
  );

  router.route("/stats-receipt-data/:date?").get(
    handleAsyncErrors(async (req, res) => {
      if (!["manager", "admin"].includes(req.user.role)) {
        throw new HttpError(403, "只有店员可以打印小票");
      }

      const receiptLogo = new Image();
      const counter = await User.findOne({ _id: req.user.id });
      const stats = await getStats(req.params.date);

      await new Promise((resolve, reject) => {
        receiptLogo.onload = () => {
          resolve();
        };
        receiptLogo.onerror = err => {
          reject(err);
        };
        receiptLogo.src = __dirname + "/../resource/images/logo-greyscale.png";
      });

      let encoder = new EscPosEncoder();
      encoder
        .initialize()
        .codepage("cp936")
        .align("center")
        .image(receiptLogo, 384, 152, "threshold")
        .newline()
        .align("left")
        .line("打印时间：" + moment().format("YYYY-MM-DD HH:mm:ss"))
        .line(`收银台号：${counter.name}`)
        .line(`成人数：${stats.customerCount}`)
        .line(`儿童数：${stats.kidsCount}`)
        .line(`袜子数：${stats.socksCount}`)
        .line(`门票收入：${stats.paidAmount - stats.socksAmount}`)
        .line(`充值收入：${stats.depositAmount}`)
        .line(`收款方式：`)
        .line(`- 余额：${stats.paidAmountByGateways[Gateways.Credit] || 0}`)
        .line(`- 券码：${stats.paidAmountByGateways[Gateways.Code] || 0}`)
        .line(`- 扫码：${stats.paidAmountByGateways[Gateways.Scan] || 0}`)
        .line(`- 现金：${stats.paidAmountByGateways[Gateways.Cash] || 0}`)
        .line(`- 刷卡：${stats.paidAmountByGateways[Gateways.Card] || 0}`);

      encoder.line(`优惠人数：`);
      if (stats.couponsCount.length) {
        stats.couponsCount.forEach(couponCount => {
          encoder.line(`- ${couponCount.name}：${couponCount.count}`);
        });
      } else {
        encoder.line("- 无");
      }

      encoder.line(`次卡券码：`);
      if (stats.codesCount.length) {
        stats.codesCount.forEach(codeCount => {
          encoder.line(`- ${codeCount.title}：${codeCount.count}`);
        });
      } else {
        encoder.line("- 无");
      }

      encoder.line(`充值开卡：`);
      if (stats.depositsCount.length) {
        stats.depositsCount.forEach(depositCount => {
          encoder.line(
            `- ${depositCount.desc}（${depositCount.price}）：${depositCount.count}`
          );
        });
      } else {
        encoder.line("- 无");
      }

      encoder
        .newline()
        .newline()
        .newline()
        .newline();

      const hexString = Buffer.from(encoder.encode()).toString("hex");

      res.send(hexString);
    })
  );

  router.route("/daily-report/:date?").get(
    handleAsyncErrors(async (req, res) => {
      const dateInput = req.params.date;
      const workbook = await XlsxPopulate.fromFileAsync(
        "./reports/templates/daily.xlsx"
      );
      const date = moment(dateInput).format("YYYY-MM-DD");
      const startOfMonth = moment(date)
        .startOf("month")
        .toDate();
      const [year, month, day, dayOfWeek] = moment(date)
        .format("YYYY MM DD dd")
        .split(" ");
      const stats = await getStats(date);
      const statsM = await getStats(date, startOfMonth);
      const data = {
        year,
        month,
        day,
        dayOfWeek,
        weather: "",
        customerCount: stats.customerCount,
        bookingAmount: stats.paidAmount - stats.socksAmount,
        couponPaid: stats.paidAmountByGateways.coupon,
        tbAmount: stats.tbAmount,
        partyAmount: stats.partyAmount,
        creditAndCodeAmount:
          (stats.paidAmountByGateways.credit || 0) +
          (stats.paidAmountByGateways.code || 0),
        restaurantAmount: "",
        drinkAmount: "",
        socksAmount: stats.socksAmount,
        depositAmount1:
          (
            stats.depositsCount.find(d => d.slug === "5-time-2-hour") || {
              count: 0
            }
          ).count * 580,
        depositAmount2:
          (
            stats.depositsCount.find(d => d.slug === "10-time-unlimited") || {
              count: 0
            }
          ).count * 1280,
        depositAmount3:
          (
            stats.depositsCount.find(
              d => d.slug === "5-time-parent-child-2-hour"
            ) || {
              count: 0
            }
          ).count * 780,
        depositAmount4:
          (
            stats.depositsCount.find(
              d => d.slug === "10-time-parent-child-unlimited"
            ) || {
              count: 0
            }
          ).count * 1680,
        depositAmount5:
          (
            stats.depositsCount.find(
              d => d.slug === "8-time-couple-unlimited"
            ) || {
              count: 0
            }
          ).count * 1314,
        codeDepositAmount: stats.codeDepositAmount,

        customerCountM: statsM.customerCount,
        bookingAmountM: statsM.paidAmount - statsM.socksAmount,
        couponPaidM: statsM.paidAmountByGateways.coupon,
        tbAmountM: statsM.tbAmount,
        partyAmountM: statsM.partyAmount,
        creditAndCodeAmountM:
          (statsM.paidAmountByGateways.credit || 0) +
          (statsM.paidAmountByGateways.code || 0),
        restaurantAmountM: "",
        drinkAmountM: "",
        socksAmountM: statsM.socksAmount,
        depositAmount1M:
          (
            statsM.depositsCount.find(d => d.slug === "5-time-2-hour") || {
              count: 0
            }
          ).count * 580,
        depositAmount2M:
          (
            statsM.depositsCount.find(d => d.slug === "10-time-unlimited") || {
              count: 0
            }
          ).count * 1280,
        depositAmount3M:
          (
            statsM.depositsCount.find(
              d => d.slug === "5-time-parent-child-2-hour"
            ) || {
              count: 0
            }
          ).count * 780,
        depositAmount4M:
          (
            statsM.depositsCount.find(
              d => d.slug === "10-time-parent-child-unlimited"
            ) || {
              count: 0
            }
          ).count * 1680,
        depositAmount5M:
          (
            statsM.depositsCount.find(
              d => d.slug === "8-time-couple-unlimited"
            ) || {
              count: 0
            }
          ).count * 1314,
        codeDepositAmountM: statsM.codeDepositAmount,
        freePlayDepositAmountM: ""
      };
      Object.keys(data).forEach(key => {
        let replace = data[key];
        if (typeof replace === "number") {
          replace = +replace.toFixed(2);
        }
        if (replace === undefined || replace === null) {
          replace = "";
        }
        workbook.find(`{{${key}}}`, replace);
      });

      const filename = `日报 ${date}.xlsx`;
      const path = `./reports/${filename}`;

      await workbook.toFileAsync(path);

      res.download(path, filename);
    })
  );

  return router;
};

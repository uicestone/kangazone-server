import WXOauth from "@xinglu/wxapp-oauth";
import { Pay, SignType, utils } from "@sigodenjs/wechatpay";
import fs from "fs";

const {
  WEIXIN_APPID,
  WEIXIN_SECRET,
  WEIXIN_MCH_ID,
  WEIXIN_MCH_KEY,
  WEIXIN_MCH_CERT_PATH,
  APP_HOME,
  DEBUG
} = process.env;

export const oAuth = WXOauth({
  appid: WEIXIN_APPID,
  secret: WEIXIN_SECRET
});
export const pay = new Pay({
  appId: WEIXIN_APPID,
  mchId: WEIXIN_MCH_ID,
  key: WEIXIN_MCH_KEY,
  pfx: fs.readFileSync(WEIXIN_MCH_CERT_PATH)
});

export const unifiedOrder = async (
  outTradeNo: string,
  totalFee: number,
  openid: string,
  body: string = " "
) => {
  if (DEBUG) {
    totalFee = totalFee / 10000;
  }
  const gatewayData = await pay.unifiedOrder({
    body,
    out_trade_no: outTradeNo,
    total_fee: Math.round(totalFee * 100),
    trade_type: "JSAPI",
    openid,
    notify_url: `${APP_HOME}/wechat/pay/notify`,
    spbill_create_ip: "8.8.8.8"
  });
  if (!pay.verifySign(gatewayData)) throw new Error("WechatPay sign error.");
  if (gatewayData.result_code === "FAIL")
    throw new Error(`Trade failed: ${JSON.stringify(gatewayData)}`);

  return gatewayData;
};

export const payArgs = (gatewayData: {
  nonce_str: string;
  prepay_id: string;
}) => {
  const timeStamp = String(Date.now()).substr(0, 10);
  const nonceStr = gatewayData.nonce_str;
  const _package = `prepay_id=${gatewayData.prepay_id}`;
  return {
    timeStamp,
    nonceStr,
    package: _package,
    paySign: utils.sign(
      SignType.MD5,
      {
        appId: WEIXIN_APPID,
        timeStamp,
        nonceStr,
        package: _package,
        signType: "MD5"
      },
      WEIXIN_MCH_KEY
    )
  };
};

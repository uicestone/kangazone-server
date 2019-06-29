import WXOauth from "@xinglu/wxapp-oauth";
import { Pay, utils as wepayUtils } from "@sigodenjs/wechatpay";
import fs from "fs";

const {
  WEIXIN_APPID,
  WEIXIN_SECRET,
  WEIXIN_KEY,
  WEIXIN_MCHID,
  APP_HOME
} = process.env;

export const wxoauth = WXOauth({
  appid: WEIXIN_APPID,
  secret: WEIXIN_SECRET
});
export const wxpay = new Pay({
  appId: WEIXIN_APPID,
  mchId: WEIXIN_MCHID,
  key: WEIXIN_KEY,
  pfx: new Buffer("")
});

export const unifiedOrder = async ({
  out_trade_no,
  total_fee
}: {
  out_trade_no: string;
  total_fee: number;
}) => {
  const gatewayData = await wxpay.unifiedOrder({
    body: "测试",
    out_trade_no,
    total_fee,
    trade_type: "JSAPI",
    notify_url: `${APP_HOME}/wechat/pay/notify`,
    spbill_create_ip: "8.8.8.8"
  });
  if (!wxpay.verifySign(gatewayData)) throw new Error("签名校验失败");
  if (gatewayData.result_code === "FAIL")
    throw new Error(`交易失败: ${JSON.stringify(gatewayData)}`);

  const timeStamp = String(Date.now()).substr(0, 10);
  const nonceStr = gatewayData.nonce_str;
  const _package = `prepay_id=${gatewayData.prepay_id}`;
  return {
    timeStamp,
    nonceStr,
    package: _package,
    paySign: wepayUtils.sign(
      // @ts-ignore
      "MD5",
      {
        appId: WEIXIN_APPID,
        timeStamp,
        nonceStr,
        package: _package,
        signType: "MD5"
      },
      WEIXIN_KEY
    )
  };
};

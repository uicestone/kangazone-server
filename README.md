[![Build Status](https://travis-ci.org/uicestone/kangazone-server.svg?branch=master)](https://travis-ci.org/uicestone/kangazone-server)

# kangazone-server

## Project setup

```
yarn
```

then create a .env file from .env.example.

### Development

```
yarn dev
```

### Compiles and minifies for production

```
yarn build
```

### Lints and fixes files

```
yarn lint
```

# APIs

`GET /stats`

```
{
  "checkedInCount":number, // 场内人数
  "dueCount":number, // 即将超时人数
  "todayCount":number, // 当日人数
  "todayAmount":number // 当日流水
}
```

## 登陆和鉴权

`POST /auth/login`

```
{
  "login":string,
  "password":string
}
```

```
{
  "token":string,
  "user":{}
}
```

`GET /auth/user`

## 订单列表

`GET /booking`

queries: `?`

`keyword=`

`orderby=`

`order=asc|desc`

`status=`

`type=`

`due=true`

## 查询用户

`/user`

queries: `?`

`keyword=`

## 创建用户

`POST /user`

## 预览预约价格

`POST /booking-price`

```
{
  "price":number
}
```

## 创建预约

`POST /booking`

queries: `?`

`paymentGateway=scan|cash|card`

`useCredit=false`

创建预约后会自动生成`booking.payments`，如果其中包含`paid:false`的`payment`则需要客户端对其手动处理支付，支付完成后通过`更新支付`接口上报支付状态。当所有`payments.paid`为`true`时，`booking`状态会自动更新为`BOOKED`

## 更新预约

绑定手环使用此接口

`PUT /booking/:id`

queries: `?`

`paymentGateway=scan|cash|card`

`useCredit=false`

签到入场即`status`由`BOOKED`改为`IN_SERVICE`

取消未付款的订单即`status`由`PENDING`改为`CANCELED`

取消订单（全额退款）即`status`由`BOOKED`改为`CANCELED`

取消订单后会自动生成`amount`为负的`booking.payments`，如果其中包含`paid:false`的`payment`则需要客户端对其手动处理退款，退款完成后通过`更新支付`接口上报支付状态。当所有`payments.paid`状态为`true`时，`booking`状态会自动更新为`CANCELED`

## 更新支付

`PUT /payment/:id`

```
{
  "paid":true
}
```

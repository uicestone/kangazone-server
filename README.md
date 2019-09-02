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
  "login":"",
  "password":""
}
```

```
{
  "token":"",
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

## 创建预约

`POST /booking`

## 更新预约

绑定手环使用此接口

`PUT /booking/:id`

签到入场即`status`由`BOOKED`改为`IN_SERVICE`

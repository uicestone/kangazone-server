import { sign, verify } from "jsonwebtoken";
import { hash, compare } from "bcryptjs";
import * as _ from "lodash";
import { IUser } from "../models/User";

interface TokenData {
  userId: number;
  userRole: string;
}
const { APP_SECRET = "test123456" } = process.env;

export const hashPwd = (password: string) => hash(password, 10);

export const comparePwd = (password: string, hashPassword: string) =>
  compare(password, hashPassword);

export const signToken = (user: IUser): string => {
  return sign(
    {
      userId: user.id,
      userRole: user.role
    },
    APP_SECRET
  );
};
export const verifyToken = (token: string): TokenData =>
  verify(token, APP_SECRET) as TokenData;

export const getTokenData = (token: string): TokenData => {
  token = token.replace(/^Bearer /, "");
  return verifyToken(token);
};

export const sleep = async (milliseconds = 500) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
};

export const icCode10To8 = (input: string): number => {
  if (input.length <= 8) {
    return +input;
  }
  const hexString = (+input).toString(16).padStart(8, "0");
  const buffer = Buffer.alloc(4, hexString, "hex");
  return buffer.readUInt8(1) * 1e5 + buffer.readUInt16BE(2);
};

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

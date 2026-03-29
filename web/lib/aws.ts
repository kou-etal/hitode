//lambdaとかでs3操作するときはcdkでIAMロールをつけていることによりSSOを設定しなくていい。
//フロントからAWS SDK扱うときはIAMロールついてないからSSO必須。
//もしこれをEC2とかにデプロイする場合はそのリソースにIAMロールつけたらSSOの設定使わない。
// そのために三項演算子で存在しない場合を許容している。
//ゆえに今回のprofileは!つけない。
//毎回のSSO部分を切り出してutilsにしている。
import { fromSSO } from "@aws-sdk/credential-provider-sso";

const profile = process.env.AWS_PROFILE;

export const awsCredentials = profile
  ? { credentials: fromSSO({ profile }) }
  : {};
//profileがあれば~/.aws/configからSSO設定とってきて~/.aws/sso/cache/のトークンを使って認証する。もしトークンが切れてたら失敗する。
// その場合はsso loginすると新たに~/.aws/sso/cache/が生成されるからエラー解消する。
export const awsRegion = process.env.AWS_REGION ?? "us-east-1";
/*SSO（Single Sign-On）= `aws sso login`で取得した一時トークンを使う方式
- アクセスキー・シークレットキーを`.env`に書かなくていい*/
/*使う側はスプレッドして使う。
  const a = { credentials: fromSSO({ profile: "default" }) };                                                                                                                                                                                                                             
  // スプレッドなし                                                                                                                          
  const obj = { region: "us-east-1", a };
  // → { region: "us-east-1", a: { credentials: fromSSO(...) } }
  // aというキーの中にネストされる

  // スプレッドあり
  const obj = { region: "us-east-1", ...a };
  // → { region: "us-east-1", credentials: fromSSO(...) }
  // aの中身が展開されてフラットになる*/

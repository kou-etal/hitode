#!/usr/bin/env node
//nodeを探す
//起動スクリプト。
//CDKは必ずbin/→lib/の構造。
import * as cdk from "aws-cdk-lib";
//aws-cdk-lib パッケージがエクスポートしてるもの全部を、cdk という名前にまとめてインポート。
/*import { App, CfnOutput, RemovalPolicy } from "aws-cdk-lib";
const app = new App(); */
import * as dotenv from "dotenv";
import { AmazonBedrockKbStack } from "../lib/stack/bedrock-kb-stack";

dotenv.config();
//cdk-> CloudFormation
//ローカルenvを環境変数に入れる。これでprocess.envが使える。
//ローカルenvからは機密情報ではなくinfraの設定を受け取る。デプロイの機密情報はAWS secret manager

const app = new cdk.App();
/*CDKアプリのルートオブジェクト。全てのスタックはappが親。CDKのでは：

  App（アプリ）
   └── Stack（スタック）= CloudFormationスタック1個分
        └── Construct（リソース）= S3, Lambda, etc.
*/

const stage: string = app.node.tryGetContext("stage") || "test";
//appが持つnodeプロパティのtryGetContextメソッド
//try->見つからなかったらundefinedを返す。stageはany型
//stageにstringつけるとprefixにはつけなくていい。新しい変数定義->型を考慮
const stagePrefix = stage.charAt(0).toUpperCase() + stage.slice(1);
//stageはany->どんなメソッドでも使える。実行時にエラーになるだけ。実行時にはstringであるからcharAt使える
//stage.slice(1) で文字の2文字目以降を取り出す。

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION,
};
// process.envのプロパティはstring | undefinedと決まっている。
//process.env.CDK_DEFAULT_ACCOUNTはaws configureが自動で設定する。存在しなかった場合process.env.AWS_ACCOUNT
//フォールバック->動作しなかった場合の代替手段

//BedrockKbStack${stagePrefix}はCloudFormationスタック名
new AmazonBedrockKbStack(app, `BedrockKbStack${stagePrefix}`, {//これは別の場所で定義したやつを使ってる
  stage,
  env,
  pineconeConnectionString: process.env.PINECONE_CONNECTION_STRING!,
  pineconeSecretArn: process.env.PINECONE_SECRET_ARN!,
  /*! は TypeScriptの 非nullアサーション。
 undefinedじゃないと保証する。実際にundefinedだとランタイムエラーになる。*/
});

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"; //s3系
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; //これは別なんや
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto"; //node環境でのuuid標準。
//nodeをつけることでNode.js標準でありnpmパッケージではないことを宣言する。別にnode:なくても動く。
import { awsCredentials, awsRegion } from "@/lib/aws"; //SSO

//TODO:apiルートはすべてtry catchするべき。今回はupload部分は環境変数ないぐらいでしか止まらないから省略してるけど。
//presigned url発行api。ブラウザでs3にputする。
const s3 = new S3Client({
  region: awsRegion,
  ...awsCredentials,
  //credentials:の形式でimport。スプレッド構文。存在しなければIAMロール使う。切り替えは自動で行われる。ロジックなし。
});

const BUCKET = process.env.RAW_IMAGE_BUCKET!;
//ここは存在しなかったら詰むから非null

export async function POST(req: Request) {
  //aws-sdk系は非同期。
  //RequestはブラウザのHTTPの標準型。req.methodとか持ってる。+メソッドも使えるようにする(req.jsonとか)、つまりプロパティとメソッド。
  //ただしbodyの中身はanyで扱う。ここがGoと違う。Goはまず型を作ってからそれに当てはめるように受け取るけどtsは一旦受け取る。
  //つまり実行しないとエラー出ない。
  //as部分でいったん型を定義する。そこでは不正の値でもundefinedになるだけでエラーにはならない。
  //その後の  if (!filename || !contentType) 部分でエラーになる。
  const { filename, contentType } = (await req.json()) as {
    //APIの仕様でbodyの読み取りは常に非同期と決まっている。Goのjson.NewDecoder(r.Body).Decode(&body)は同期。
    // anyのjsonに対して型を付与する。これは決めつけているだけ。デプロイ時には消える。
    // ローカルでstringではありえない操作を警告するだけ。実際にnumberでもstringって決めつけてる。
    //TODO:実際にはzodでDTO入れるべき、さらにrate_limitと認証入れないとclaude sonnetが大量に呼び出される。
    filename: string;
    contentType: string;
  };

  if (!filename || !contentType) {
    return NextResponse.json(
      { error: "filename and contentType are required" },
      { status: 400 },
    );
    //NextResponse.json() — Next.jsの便利メソッド。new Response(JSON.stringify(...))の省略形
    /*TODO:ヘルパー作ったほうが良い。
      export function errorResponse(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
  }
  export function successResponse(data: unknown) {
    return NextResponse.json(data);
  }*/
  }

  const imageId = randomUUID();
  const key = `raw-images/${imageId}/${filename}`;
  //ディレクトリのように見えるがだがS3にディレクトリはない。key全部でファイル名。

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
  //いつもはs3クライアント+objectやけど今回はs3に操作するわけではない。s3からurlをもらうだけ。s3.sendは使わない。
  //URLを受け取ったブラウザは、AWS認証なしでS3に直接PUTできる

  return NextResponse.json({ imageId, presignedUrl, key });
  //TODO:これimageIDは返さなくていい。
}

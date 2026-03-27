//設計図
import * as path from "node:path";
//パスassemble。絶対パスは使えない。 path.resolve(__dirname, "../lambda/image-ocr/index.ts")で使う。
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
/*CDKでは全てのリソース（S3, Lambda, IAMロール等）が Construct を継承してる。
App（Construct）
   └── Stack（Construct）
        ├── S3 Bucket（Construct）
        ├── Lambda（Construct）
        └── IAM Role（Construct）
CDK以外（Terraform CDKなど）でも使えるからCDKからimportしていない。
 リソース作成時の第1引数 this も Construct*/
import {
  aws_s3 as s3,
  aws_iam as iam,//iam.PolicyStatement（LambdaにBedrock呼び出し権限を付与）
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_s3_notifications as s3n,//S3イベントnotification。s3n.LambdaDestination（S3にファイル置いたらLambda発火）
  RemovalPolicy,
  CfnOutput,
} from "aws-cdk-lib";//これは別でimportするのが慣習
/*removalpolicyはスタック削除した時の挙動。デフォルトはretainになってる。cdk destroyでスタック消してもS3とかRDSは残る。
dev環境ではこれをリソースも消すように設定。*/
/*L1,L2,L3。CDKのConstruct（リソース定義）の抽象度レベル。
 L1（Low-level） = Cfn〇〇 CloudFormationをTypeScriptで書いただけ → 全プロパティ手動指定。
 L2（High-level） = Bucket, Function   → L1をラップして便利にしたもの→ デフォルト設定、IAM自動生成、メソッド付き
 L3（Patterns） = 複数リソースをまとめたもの L2を合わせたセット
 // L1: 全部自分で書く
  new s3.CfnBucket(this, "Bucket", {
    bucketName: "my-bucket",
    versioningConfiguration: { status: "Enabled" },
    bucketEncryption: {
      serverSideEncryptionConfiguration: [{
        serverSideEncryptionByDefault: { sseAlgorithm: "AES256" }
      }]
    },
    // IAMポリシーも別途自分で作る...
  });

  // L2: これだけで同じことができる
  const bucket = new s3.Bucket(this, "Bucket", {
    versioned: true,
    encryption: s3.BucketEncryption.S3_MANAGED,
  });
  bucket.grantRead(myLambda); // IAMポリシー自動生成
  s3とかにはL2があるがbedrockとpineconeにはL2ないから別パッケージからimportしている*/
  /*今回のプロジェクトではlambda使ってる。これはコードがないと動かない->デプロイ。
  それがnodejs.NodejsFunction。ここでtsからesbuild->デプロイしてる。デプロイ先のs3は自動生成。
  nodejs使うためのランタイム設定のlambda import。infraもデプロイする。
  npm run buildで型チェックしてからesbuild。これは非効率にも思える。
  cdk deployコマンドにtsc入れるのもあり。まあでも型チェックはCI/CDとかで担保してるからdeployはesbuildという考え方もあり。*/
  /* CfnOutput　デプロイ完了後にターミナルに値を表示する。なくても動く。便利機能
このプロジェクトでの使い方（L213, L217, L221）
  new CfnOutput(this, "RawImageBucketName", {
    value: rawBucket.bucketName,
  });

  new CfnOutput(this, "KnowledgeBaseId", {
    value: knowledgeBase.knowledgeBaseId,
  });

  デプロイ後にこう表示される:

  Outputs:
  BedrockKbStackTest.RawImageBucketName = bedrock-kb-test-raw-123456-ap-northeast-1
  BedrockKbStackTest.KnowledgeBaseId = XXXXXXXXXX

  デプロイで作られたリソースのIDや名前がわかると作業しやすい*/

import {
  bedrock,
  pinecone,
} from "@cdklabs/generative-ai-cdk-constructs";
/*aws-cdk-libだけやと低レベルな CloudFormation リソース（Cfn〇〇）だけで、Bedrock
 KBやPinecone連携は自分でIAMロールやポリシーを全部手書きする必要がある。
 @cdklabs/generative-ai-cdk-constructs はそれを数行で書けるようにまとめたもの。*/
 //aws bedlockはai詰め合わせ。モデル呼び出し、kb、agents、Guardrails（AIの出力を制限する）。
 // kbはオーケストレーション層、保存先ではない。保存先はpinecone
                                                                                                                                              @cdklabs/generative-ai-cdk-constructs はそれを数行で書けるようにまとめたもの。

interface BedrockKbStackProps extends cdk.StackProps {
  stage: string;
  pineconeConnectionString: string;
  pineconeSecretArn: string;
}/*
  interface Foo { name: string }
  type Foo = { name: string } 
  cdk.StackPropsがinterfaceやから慣習的にinterface使う。
  別にtype BedrockKbStackProps = cdk.StackProps & { ... } って記法可能。extendsのほうが分かりやすい。
  今回のinterfaceはDIPではなくデータ型の定義のinterface->使う側ではなく定義側に置く。
  cdk.StackProps を継承してるからenv系は受け取れる。
  */


export class AmazonBedrockKbStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BedrockKbStackProps) {
    //scopeはルートオブジェクト(app)、idはcloudformationスタック名。
    super(scope, id, props);//親クラスのconstructer使う。新しく定義しなくてよい。便利。
    //ここでprops系がプロパティに登録されるからthis.regionが使える。
    // idはCDKが内部でCloudFormationのスタック名やリソースの論理IDの生成に使う

    const tag = `bedrock-kb-${props.stage}`;//ts記法
    //論理IDはパスカルケース。AWSはケバブケース。

    /* 1. Upload用バケット*/

    const rawBucket = new s3.Bucket(this, "RawImageBucket", {//これも第二引数はCDKが使う。bucketnameが実際のAWSリソース
      //ここでのthisはAmazonBedrockKbStack。appではない。そしてappにstackをセットする。
      //stackは分けることもできる。現在は1スタック。実務ではライフサイクルで分ける。
      // VPCはほぼ動かさないから一スタック。Lambdaとかは変えること多いから別スタック。安全にインフラを扱う。
      bucketName: `${tag}-raw-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,//これはセット
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,//s3は公開しない。
      // webサイトは公開する場合もあるけどそれでもcloudfront経由でs3は公開しない。
      /*CORS。異なるドメインへのリクエストをブロックする。s3は認証ないとアクセスできない+認証あってもCORSではじかれるの2段階
      Presigned URL->一時的にS3へのアクセスを許可するURL
       https://my-bucket.s3.amazonaws.com/image.png は不可
      　https://my-bucket.s3.amazonaws.com/image.png?X-Amz-Signature=abc123&X-Amz-Expires=3600&...はok
      next側で発行する
      */
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          //presigned URLはバケット操作全許可ではなくバケットのパス(key)部分許可。keyとのセットであるからpostではなくput使う。
          allowedOrigins: ["http://localhost:*"],//ローカルからのアップロードを許可。ここハードコードにしないほうがいい。
          /*  1. 環境変数で切り替える  allowedOrigins: [process.env.ALLOWED_ORIGIN || "http://localhost:*"],
       2. 両方許可するallowedOrigins: ["http://localhost:*", "https://yourdomain.com"],*/
          allowedHeaders: ["*"],
          //CORSヘッダーは認証ではなくブラウザの制限、絞ってもセキュリティ的なメリットは薄い。
        },
      ],
    });

    /* 2. KB DataSource用バケット*/
    //OCR後のテキストファイルを置く。

    const dataSourceBucket = new s3.Bucket(this, "DataSourceBucket", {
      bucketName: `${tag}-datasource-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
 /* S3 バージョニング->同じファイルを重ね書きした時に、古いバージョンも残す。
 KBはデータソース（S3）を定期的にスキャンして、変更があったファイルだけを再処理する。
 datasourceは差分を扱う。->ベクトル  */
 /*ブラウザ → S3:  ブラウザはAWS外 → IAM認証持てない → 署名付きURL必要
     Lambda → S3:同じAWS内 → IAMロールで認証 → 直接アクセスできる
 Bedrock KB → S3: 同じAWS内 → IAMロールで認証 → 直接アクセスできる
 -> grantRead / grantWrite*/
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    /* 3. Pinecone Vector Store */

    //ここはAWSリソース作ってない。保存先の設定
    // 複数のスタックでPinecone設定を共有するならファイル分ける意味あるけど、今は1箇所でしか使ってないからここでいい。
    const pineconeStore = new pinecone.PineconeVectorStore({
      connectionString: props.pineconeConnectionString,
      //Pinecone のエンドポイントURL "https://my-index-abc123.svc.pinecone.io"
      credentialsSecretArn: props.pineconeSecretArn,//Pinecone の API キーが保存されてる Secrets Manager の ARN
      textField: "text",
      metadataField: "metadata",
      /* Pinecone に保存されるデータ:
{
    "id": "abc-123",
    "values": [0.023, -0.041, 0.087, ...],  // ベクトル（自動生成）
    "text": "この画像には猫が写っています...",  // ← textField
    "metadata": { "source": "image-001.png" }  // ← metadataField
  }*/ 
    });

    /* 4. Knowledge Base*/

    const knowledgeBase = new bedrock.VectorKnowledgeBase(
      this,
      "KnowledgeBase",
      {
        vectorStore: pineconeStore,
        embeddingsModel:
          bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V1,
          // Titan Embed Text V1:    1536次元、安い、古いけど十分
          //  Titan Embed Text V2:    1024次元、多言語改善、新しい。日本語メインならいい。
          //Cohere Embed:           高精度、 expensive
          //変えるならばPinecone側のインデックスの次元数と合わせる。途中で変えるとデータ作り直し
        name: `${tag}-kb`,//ここ統一感なくて良くない。アカウントIDやリージョン
        description: "Image Knowledge Base",
      }
    );

    const s3DataSource = knowledgeBase.addS3DataSource({
      bucket: dataSourceBucket,//バケット名ではなくインスタンス名
      dataSourceName: `${tag}-s3-source`,
      chunkingStrategy: bedrock.ChunkingStrategy.NONE,
      //チャンキング->ドキュメントをベクトルにする前に分割すること
      /*チャンキングあり:
    長いドキュメント → 300文字ずつに分割 → それぞれベクトル
    → 検索精度（関連する部分だけヒットする）
    今回は短いから分けていない。*/
    //noneにして完全にカスタムチャンキング、あるいはchunkingstrategy使う+lambda
    //カスタムチャンキングのlambdaはmax5分の場合もある。
    //datasourceはコンストラクタに1つだけ書く設計だと複数対応できない。add〇〇 メソッドで後から追加する設計の方が良い。
    });

    /* 5. Image OCR Lambda (Raw → テキスト抽出 → DataSource)*/
//nodejsfuncytion->TypeScriptを自動でビルド（esbuild）してデプロイしてくれる
    const ocrLambda = new nodejs.NodejsFunction(this, "ImageOcrLambda", {
      functionName: `${tag}-image-ocr`,//lambdaはfunction name
      entry: path.resolve(__dirname, "../lambda/image-ocr/index.ts"),//path assemble
      runtime: lambda.Runtime.NODEJS_22_X,
      //ランタイム。普通は最新を使う。もし既存ラムダとか依存ライブラリで制約あるならば古いバージョン
      handler: "handler",
      //Lambda関数のエントリーポイント。今回はhandlerという名前のexportされた関数をエントリーにしている。
      timeout: cdk.Duration.minutes(5),//CDKが型安全に変換してくれる。
      // Lambda関数の実行時間のmax、lambdaのmaxは15分。OCRは重いから5分に設定。
      memorySize: 1024,
      /*Lambda のメモリ割り当て
       128MB:  シンプルなAPI応答
  256MB:  普通の処理
  512MB:  ちょっと重い処理
  多いとコスト増、多くないと遅い、OOM。*/
      environment: {//ここでprocess.envに注入。
        //いやここでのprocess.envはlambdaのenvであって普通のprocess.envとは違う。
      // さっきのkbはインスタンス名やったけど今回はCloudFormationの設定値になるからstring
        RAW_BUCKET: rawBucket.bucketName,
        DATA_SOURCE_BUCKET: dataSourceBucket.bucketName,
        VLM_MODEL_ID: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      },
      bundling: { externalModules: [] },
      // esbuildでバンドルする時に外部扱いにするモジュール設定。
    });
    //設定項目は最適はドキュメント読む。でもAIに出力させて必要十分かを確かめる->セカンドベストあるいは今の時代ではベスト

    //s3はL2やからiam policyも簡単に設定できる。
    rawBucket.grantRead(ocrLambda);//これはインスタンス
    dataSourceBucket.grantWrite(ocrLambda);
    
//bedrockはL2存在しない->記述
//bedrockはモデル決定(全リージョン共有)と、プロファイル設定(リージョン依存)の2層構造。
    ocrLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        // grantRead のようなL2メソッドがない場合、ドキュメントでAPI使うにはどのIAMアクションが必須かを調べて記述する。
        resources: [
          //どのリソースに対して許可するか決めてる。
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0`,
          //us(リージョン名)つけるだけ。
          "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0",
          //これはAIモデル決定したら表示される。
        ],
      }),
    );
//claudeはmarketplace必要。invokemodelの際にmarketplaceの権限ないと失敗する場合ある。関心が違うから分けている。
//そもそもresourceの粒度違うからまとめることできない。
    ocrLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "aws-marketplace:ViewSubscriptions",
          "aws-marketplace:Subscribe",
        ],
        resources: ["*"],
      }),
    );

    //raw保存されたらocrトリガー
    //これはs3->lambdaへのトリガー。lambdaは実行する側->notificationで記述できる。
    rawBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      //createdにしてる。これはputも含む概念。rawのアップロードはputにしている。テストでurl通さずにアップロードする場合もputになる。
      //ファイルが大きすぎて分割になった場合はputで対応できない->create。
      //まあでも5MB制限にしてるからファイル分割されることはない。
      new s3n.LambdaDestination(ocrLambda),
      { prefix: "raw-images/" },

      //バケットに適当なtemp/testとかおいてもトリガーしないようにしている。
    );

    /* 6. Ingestion Lambda*/
//これはs3->kbへのトリガー。lambdaが実行する側ではない->notificationでは記述できない->synclambda使う。
// そうするとs3->lambdaのトリガーになる。
    const syncLambda = new nodejs.NodejsFunction(this, "SyncLambda", {
      entry: path.resolve(__dirname, "../lambda/sync-kb/index.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,//TODO:これ統一する
      environment: {
        //kbに与えるデータはバケット名ではなくbedrock　apiが使うID。これはバケット名とは違い自分で定義ではなくCDKが定義する。

        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        DATA_SOURCE_ID: s3DataSource.dataSourceId,//これは単なるdatasourceではなくkbに付与したdatasource
      },
    });

    syncLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:StartIngestionJob",//kb使う権限
          "bedrock:AssociateThirdPartyKnowledgeBase",//pinecone使うための権限。
        ],
        resources: [knowledgeBase.knowledgeBaseArn],
        //今まではstring。いやちがう。さっきはAWSが作ったリソースに対してやからハードコーディングできた。
        //今回は自分が作ったリソース->CDKが作ったプロパティを受け取る。
      })
    );

    dataSourceBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(syncLambda)
      //ここはprefixない。さっきはrawでブラウザアップロードできた->prefixつける。
      //TODO:でもここになかったら統一感ない->ocr記述側にocr-resultプレフィックスつけてnotification側にもprefixつける。
    );

    /*  7. Outputs */
//web側のenvに設定必須の値を出力している。別になくてもいい。
    new CfnOutput(this, "RawImageBucketName", {
      value: rawBucket.bucketName,
    });

    new CfnOutput(this, "DataSourceBucketName", {
      value: dataSourceBucket.bucketName,
    });

    new CfnOutput(this, "KnowledgeBaseId", {
      value: knowledgeBase.knowledgeBaseId,//ここはID
    });
    //s3系はバケット名でアクセスする。kbはapi側で使うときIDを使う。name使わない。使う側に応じた値を返してる。
    // name はコンソールで見やすくするため、id はプログラムから操作するため。
  }
}
//検索・回答する部分はここにない。それは web側。
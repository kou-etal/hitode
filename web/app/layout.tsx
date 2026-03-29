import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
/*
Reactではすべてclient component。Nextからserver componentが使われるようになった。
React App Routerにはserver componentとclient componentがある。
Server Componentはページ表示の際に一回実行、Client Componentはユーザー操作で再レンダリングする
Nextのデフォルトはserver componentでありuse clientした場合client componentになる。
client componentはクライアント側で処理を実行する。use系の関数を使える。
server componentはサーバー側で処理を実行する。use系の関数使えない。
use系使ってる+apiをたたいている->client component
use系使わずに処理を直で記述してる->server component
じゃあserver componentに全部記述してapiルートもserver actionsもなしでいいっていうわけではない。
server componentはあくまで一回だ実行。一覧読み込みなどで使う。
ボタン押したらどうなるっていうのはapiルートもserver actionsでしか記述できない。
client componentはほぼCSR、server componentはSSR。
SSRは処理が効率的、SEOに強い(現代のクローラーはJS実行できるからCSRも完全不可ではない)
ゆえにNextの標準はデフォルトがserver component。一部分だけclient componentにする。
一覧表示や、変わらない部分はservercomponentで実行して、apiルートたたいたりserver actions、use系使うときはclientcomponent使う
そのclient部分をcomponent/に切り出して、layout.tsxとかpage.tsはserver componentが最適。
今のプロジェクトではすべてがclient componentになってる。レガシー寄り。 
server actions、apiルートの分岐、そしてserver component、client componentの分岐。
*/ 
/*React routerでは
<Route element={<Layout />}>
    <Route path="/image-chat" element={<ImageChat />} />
    <Route path="/images" element={<Images />} />
  </Route> ルート+配置*/
  //nextではlayout.ts配置するだけでページ全部にかかる。app/のファイルは一がルーティング、ネストも可能。
  // layout.tsxと同じ階層にtemplate.tsxやloading.tsx、error.tsxを置ける。置くだけですべてのページに適応。
  /*一部のページに適応したいときは
  image-chat/
  │   ├── layout.tsx          ← image-chatだけレイアウト
  │   └── page.tsx*/
  /* 複数ページにだけ共通で適用したいなら、グループフォルダを使う
  (admin)/                ← 括弧つきはURLに影響しない
  │   ├── layout.tsx          ← adminグループだけの追加レイアウト
  │   ├── users/page.tsx      ← /users
  │   └── settings/page.tsx 
()をつけるとURLにならない。*/

import "./globals.css";
//global.cssはcss変数とtailwind。tailwindv4からconfigファイルなくなりglobal.cssに記述する仕様。
/*css変数 global.cssで
:root {
    --primary: hsl(240 5.9% 10%);
}これを定義すると 使う側が
.button {
    background-color: var(--primary);
  }
これで使える。ダークモード、shad/ciで有用。shad/ciはbg-primaryとか使ってる。shad/ciのレイアウトを変えたいときは
global.cssを編集する。さらにtaiwindでbg-colorを直で記述した場合ダークモード対応できない。
color系はbg-primaryで記述してダークモードになるとglobal.cssで記述するだけ。
tailwindにもbg-blue-500 dark:bg-blue-800の記述はあるが量が多くなると終わる。
CSSではcolor系はglobal.cssでレイアウト系はtailwindで両方使う構成が多い。*/

export const metadata: Metadata = {
  title: "Hitode - 画像チャット",
  description: "画像をアップロードして、AIと画像について会話できるアプリ",
};//nextのmetadata型。 titleはtabに表示される。descriptionはgoogleのSEO用。
//htmlにmetadataを記述しなくていい。metadata変数をexportするだけで設定される。
//metadataという変数のexportをNext.jsが特別扱いしてる。

export const viewport = {
  maximumScale: 1,
};
//safariはinput押すと自動でズームする仕様ある。それを消す。それだけでなくズームも不可にしてる。
//アクセシビリティ的にはピンチズームできた方がいいから、本来はmaximumScale: 1を避けるべきという意見もあるらしい。
//viewport変数もexportするだけで設定される。metadataと同様。
//loading.tsx → ローディングUI、error.tsx → エラーUI、layout.tsx → レイアウトも同様。


//ここはfontをimportしてる。geistはgoogleのフォント。毎回importすると遅いからサーバーにダウンロードする。
//クラスではなく関数。geistが大文字になってるのは違和感。
//subsets: ["latin"],でアルファベットとnumberを使う。japaneseには対応していない。
//japaneseはデフォルトのMeiryo(windows) Hiragino(mac)。
//npx create-next-appでプロジェクト作るとlayout.tsxにGeist系のコード生成される。当然カスタマイズ可能。InterやNoto Sans JP
const geist = Geist({
  subsets: ["latin"],
  display: "swap",
//swapはフォントダウンロードされるまで別のシステムフォント。blockはダウンロードされるまで何も表示しない。
  variable: "--font-geist",
  //css変数に登録。--font-geistで使える。
});//Geistは等幅フォントではない。コード系は等幅フォントのGeist_Mono使ってる。

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

//スマホで見た時のURLバーの部分を変える。ダークモードの時に浮かないように設定している。これはデフォルトで生成されない。
//別になくても動く。Reactの実行より先に動くからcss変数変数では不可。
const LIGHT_THEME_COLOR = "hsl(0 0% 100%)";
const DARK_THEME_COLOR = "hsl(240deg 10% 3.92%)";
const THEME_COLOR_SCRIPT = `\
(function() {
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  function updateThemeColor() {
    var isDark = html.classList.contains('dark');
    meta.setAttribute('content', isDark ? '${DARK_THEME_COLOR}' : '${LIGHT_THEME_COLOR}');
  }
  var observer = new MutationObserver(updateThemeColor);
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
  updateThemeColor();
})();`;

export default function RootLayout({
  //RootLayoutこれ別に名前何でもいい。ファイル名layout.txtが決まってる。
  /*  <RootLayout sample="hello">
  <div>中身</div>                                                                                                                          
  </RootLayout>で定義した場合両方props.で受け取る。props.sampleとprops.children

  function RootLayout(props) {
    const children = props.children;
  }を簡単に記述するのが分割代入。function RootLayout({ children }) { ... }
  */ 
  children,
}: Readonly<{
  children: React.ReactNode;
  //Readonly<{ children: React.ReactNode }>はユーティリティ型。既存の型を変換して新しい型を作る。
  /*
  type User = { name: string; age: number };  
   Readonly<User>    // → { readonly name: string; readonly age: number }  全部読み取り専用
   Partial<User>     // → { name?: string; age?: number }  全部オプショナル
   Required<User>    → { name: string; age: number }  全部必須
   今回はレイアウト側で中身を変えられたら困るからReadOnly
   */

}>) {
  return (
    <html
    //タグの中にはコメント記述可能。
      className={`${geist.variable} ${geistMono.variable}`}
      //css変数の使い方ここでは違う。
      lang="ja"
      //nextthemeではdarkモードになるとhtmlタグの中にclass=dark記述する。
      //classdarkになるとcss変数が適応されてダークモードになる。
      //darkモードの切り替えUIは自分で作る。切り替えデータはlocalstorageに保存するからサーバーサイドではclassdarkなし、
      // フロントのhtmlではclassdarkあり。これらの不一致によりreactが警告だす。
      //それを消すためにsuppressHydrationWarning
      //TODO:ダークモード切替UI作る。
      suppressHydrationWarning
      
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "Required"
          dangerouslySetInnerHTML={{
            __html: THEME_COLOR_SCRIPT,
          }}
          //通常head部分はmetadataでexportするけど今回はURL部分のインラインスクリプト使ってる。
          //Reactではscriptの中のjs実行できない。そもそもReactはロジック部分は別に切り出して
          //<button onClick={handleClick}>押す</button>;の形式にする。
          //今回はReactが実行されるよりも先にURL部分のレイアウトに適応したいからScriptの中にhtmlで対応している。
          //dangersetinnerhtmlとlint回避
        />
      </head>
      <body className="antialiased"
      //フォントのギザギザを滑らかにするtailwind
      >
        <ThemeProvider
        //これはnextthemeの設定部分。ほぼデファクトの設定。
        //layout.tsxは使う側。定義側がui/theme-provider.tsx
        //themeprividerはuse clientを宣言していないからimportして使うとサーバー側で実行されてlocalstorage仕様によりエラーになる。
        //ui/theme-provider.tsxがわでuse client宣言してclient componentにしている。
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <Toaster position="top-center" 
          //childrenでtoaster使ったときの位置を決めている。
          //alertはユーザーの操作を止めるから、今のアプリではほぼ使わない。Toasterの方がUX的にいい。
          //toasterはすでにuse clientで宣言されているためこちらで宣言しないで使える。
          />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
/*clsx-classNameのtrue faslseの分岐を簡単にする。
ユーザーの状態によってUIを変えたいとき。 
<div className={`text-sm ${isActive ? "bg-blue-500" : ""} ${isError ? "text-red-500" : ""}`} />
これは分岐増えるとコード複雑。clxs使うと。<div className={cn(
    "text-sm",
    isActive && "bg-blue-500",
    isError && "text-red-500",
  )} />これがfalse && "bg-blue-500"とかになってfalse部分はオフになる。
  twMergeはclass名の衝突をなくす。exportのボタンが
    function Button({ className, ...props }) {
    return <button className={cn("bg-primary text-white px-4", className)} {...props} />
  }これで使う側でclassNameを重ね書きしたい場合に使う。
  ...propsはclassName以外のonClick={handleClick} disabled={true} type="submit"とかを展開してる。
  これらを含んだcnがないとshadcnは動かない。
  shadcnはpnpm installではなくコードを直接componentsに置く形式。*/

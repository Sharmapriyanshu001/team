import MySeoWork from "../../shared/seo/MySeoWork";
import leaderApi from "../leaderApi";

export default function SeoWork() {
  return <MySeoWork api={leaderApi} base="/leader" />;
}

import MySeoWork from "../../shared/seo/MySeoWork";
import employeeApi from "../employeeApi";

export default function SeoWork() {
  return <MySeoWork api={employeeApi} base="/employee" />;
}

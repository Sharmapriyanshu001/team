import MyVault from "../../shared/vault/MyVault";
import employeeApi from "../employeeApi";

export default function VaultPage() {
  return <MyVault api={employeeApi} base="/employee" />;
}

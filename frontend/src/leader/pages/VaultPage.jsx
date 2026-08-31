import MyVault from "../../shared/vault/MyVault";
import leaderApi from "../leaderApi";

export default function VaultPage() {
  return <MyVault api={leaderApi} base="/leader" />;
}

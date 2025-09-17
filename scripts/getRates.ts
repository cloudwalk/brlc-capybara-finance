import { ethers } from "ethers";
import fs from "fs";

// Input parameters
const RPC_URL = process.env.SP_RPC_URL ?? "http://spec.mainnet.cloudwalk.network:9934?app=user-evgenii";
const ABI_JSON_PATH = process.env.SP_ABI_JSON_PATH ?? "abi.json";
const CONTRACT_ADDRESS = process.env.SP_CONTRACT_ADDRESS ?? "0x66ca4827747d7065dac910845a46a82f94851be2";
const BLOCK_TAG = process.env.SP_BLOCK_TAG ?? "0x681F298"; // block number hex or "latest"
const LOAN_ID = parseInt(process.env.SP_LOAN_ID ?? "123");

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const abi = JSON.parse(fs.readFileSync(ABI_JSON_PATH, "utf8"));
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
  const loanState = await contract.getLoanState(LOAN_ID, { blockTag: BLOCK_TAG });
  const interestRatePrimary = loanState.interestRatePrimary;
  const interestRateSecondary = loanState.interestRateSecondary;

  console.log("Interest rate primary:", interestRatePrimary.toString());
  console.log("Interest rate secondary:", interestRateSecondary.toString());
}

main().catch((err) => {
  throw err;
});

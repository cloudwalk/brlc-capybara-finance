import { ethers, upgrades } from "hardhat";

async function main() {
  const CONTRACT_NAME = ""; // TBD: Enter contract name
  const CONTRACT_OWNER = ""; // TBD: Enter contract owner address

  const factory = await ethers.getContractFactory(CONTRACT_NAME);
  const proxy = await upgrades.deployProxy(
    factory,
    [CONTRACT_OWNER],
    { kind: "uups" },
  );

  await proxy.waitForDeployment();

  console.log("Proxy deployed:", await proxy.getAddress());
}

main().catch((err) => {
  throw err;
});

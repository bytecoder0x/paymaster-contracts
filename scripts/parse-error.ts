import { ERC20__factory, IEntryPoint__factory, TokenPaymaster__factory } from "../typechain-types";

const errorData =
  "0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002645524332303a207472616e7366657220616d6f756e7420657863656564732062616c616e63650000000000000000000000000000000000000000000000000000";

async function main() {
  const postOpErrorReason = IEntryPoint__factory.createInterface().parseError(
    errorData.toLowerCase(),
  );
  console.log("postOpErrorReason", postOpErrorReason);

  // const parsed = ERC20__factory.createInterface().parseError(errorData);
  // console.log(parsed);

  // const parsed = ERC20__factory.createInterface().parseError(postOpErrorReason);
  // console.log(parsed);
}

main();
# Paymaster Contracts

## Project requirements

- Yarn = v4.6.0
- Node ≥ v20.0.0

## Before start...

- Install all modules using `yarn`;
- Create `.env` file and complete it with your variables according to `.env.example`.

All necessary constants for deployment separated by network name should be stored in [`./constants/deploy.ts`](./constants/deploy.ts).

## Scripts

### Install dependencies

```shell
yarn install
```

### Run local node

```shell
yarn chain
```

### Run tests

```shell
yarn test
```

### Get test coverage

```shell
yarn coverage
```

### Generate docs

```shell
yarn docs
```

### Compile contracts

```shell
yarn compile
```

### Deploy contracts

This repository uses Hardhat Ignition for contract deployment. To deploy paymaster contracts, run:

```shell
yarn deploy <network_name>
```

The contracts' deployed address will be saved in `./ignition/deployments/chain-<chain_id>/deployed_addresses.json`, where `chain_id` is the ID of the deployment chain.

For a fresh deployment or to reset previous executions, clear the previous state with:

```shell
yarn clear-state <deployment_id> <module>#<contract_name>
```

The `deployment_id` is obtained as:

```shell
deployment_id = 'chain-' + <chain_id>
```

For more information about Hardhat Ignition see official [documentation](https://hardhat.org/ignition/docs/getting-started#overview).

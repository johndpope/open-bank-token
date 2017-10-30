import * as Web3 from 'web3';
import {Wallet, Contract,
    providers as Providers,
    provider as Provider} from 'ethers';
import * as BigNumber from 'bn.js';
import * as logger from 'config-logger';
import * as VError from 'verror';

import {TransactionReceipt, EventLog} from 'web3/types.d';
import {EthSigner} from './ethSigner/index.d';

declare type HolderBalances = {
    [holderAddress: string] : number
};

export default class Token
{
    readonly web3: Web3;
    readonly provider: Provider;

    // TODO the following needs to be removed events switched from web3 to Ethers
    web3Contract: object;
    contract: object;
    contractOwner: string;
    contractBinary: string;

    defaultGas = 120000;
    defaultGasPrice = 2000000000;

    transactions: { [transactionHash: string] : number; } = {};

    constructor(readonly url: string, contractOwner: string, readonly ethSigner: EthSigner,
                readonly jsonInterface: {}, binary?: string, contractAddress?: string)
    {
        this.contractOwner = contractOwner;
        this.contractBinary = binary;

        const description = `connect to Ethereum node using url ${url}`;

        logger.debug(`About to ${description}`);

        this.web3 = new Web3(url);
        this.provider = new Providers.JsonRpcProvider(url, true, 100);  // ChainId 100 = 0x64

        this.web3Contract = new this.web3.eth.Contract(jsonInterface, contractAddress, {
            from: contractOwner
        });

        this.contract = new Contract(contractAddress, jsonInterface, this.provider);

        this.ethSigner = ethSigner;
    }

    // deploy a new web3Contract
    deployContract(contractOwner: string, symbol: string, tokenName: string, gas = 1900000, gasPrice = 4000000000): Promise<string>
    {
        const self = this;
        this.contractOwner = contractOwner;

        const description = `deploy token with symbol ${symbol}, name "${tokenName}" from sender address ${self.contractOwner}, gas ${gas} and gasPrice ${gasPrice}`;

        return new Promise<string>(async (resolve, reject) =>
        {
            logger.debug(`About to ${description}`);

            if (!self.contractBinary) {
                const error = new VError(`Binary for smart contract has not been set so can not ${description}.`);
                logger.error(error.stack);
                return reject(error);
            }

            try
            {
                const deployTransaction = Contract.getDeployTransaction(self.contractBinary, self.jsonInterface, symbol, tokenName);

                const wallet = new Wallet(await self.ethSigner.getPrivateKey(contractOwner), self.provider);

                // Send the transaction
                const broadcastTransaction = await wallet.sendTransaction(deployTransaction);

                logger.debug(`${broadcastTransaction.hash} is transaction hash for ${description}`);

                // wait for the transaction to be mined
                const minedTransaction = await self.provider.waitForTransaction(broadcastTransaction.hash);

                logger.debug(`Created contract with address ${minedTransaction.creates} using ? gas for ${description}`);

                // TODO once all is switched to Ethers then the following can be removed
                self.web3Contract.options.address = minedTransaction.creates;

                self.contract = new Contract(minedTransaction.creates, self.jsonInterface, wallet);

                resolve(minedTransaction.creates);
            }
            catch (err)
            {
                const error = new VError(err, `Failed to ${description}.`);
                logger.error(error.stack);
                reject(error);
            }
        });
    }

    // transfer an amount of tokens from one address to another
    transfer(fromAddress: string, toAddress: string, amount: number, _gas?: number, _gasPrice?: number): Promise<string>
    {
        const self = this;

        const gas = _gas || self.defaultGas;
        const gasPrice = _gasPrice || self.defaultGasPrice;

        const description = `transfer ${amount} tokens from address ${fromAddress}, to address ${toAddress}, contract ${this.web3Contract._address}, gas limit ${gas} and gas price ${gasPrice}`;

        return new Promise<string>(async (resolve, reject) =>
        {
            try
            {
                const privateKey = await self.ethSigner.getPrivateKey(fromAddress);
                const wallet = new Wallet(privateKey, self.provider);

                const contract = new Contract(self.contract.address, self.jsonInterface, wallet);

                // send the transaction
                const broadcastTransaction = await contract.transfer(toAddress, amount, {
                    gasPrice: gasPrice,
                    gasLimit: gas
                });

                logger.debug(`${broadcastTransaction.hash} is transaction hash and nonce ${broadcastTransaction.nonce} for ${description}`);

                const transactionReceipt = await self.processTransaction(broadcastTransaction.hash, description, gas);

                resolve(broadcastTransaction.hash);
            }
            catch (err) {
                const error = new VError(err, `Failed to ${description}.`);
                logger.error(error.stack);
                reject(error);
            }
        });
    }

    async getSymbol(): Promise<string>
    {
        const description = `symbol of contract at address ${this.contract.address}`;

        try
        {
            const result = await this.contract.symbol();
            const symbol = result[0];

            logger.info(`Got ${symbol} ${description}`);
            return symbol;
        }
        catch (err)
        {
            const error = new VError(err, `Could not get ${description}`);
            logger.error(error.stack);
            throw error;
        }
    }

    async getName(): Promise<string>
    {
        const description = `name of contract at address ${this.contract.address}`;

        try
        {
            const result = await this.contract.name();
            const name = result[0];

            logger.info(`Got "${name}" ${description}`);
            return name;
        }
        catch (err)
        {
            const error = new VError(err, `Could not get ${description}`);
            logger.error(error.stack);
            throw error;
        }
    }

    async getDecimals(): Promise<number>
    {
        const description = `number of decimals for contract at address ${this.contract.address}`;

        try
        {
            const result = await this.contract.decimals();
            const decimals = result[0];

            logger.info(`Got ${decimals} ${description}`);
            return decimals;
        }
        catch (err)
        {
            const error = new VError(err, `Could not get ${description}`);
            logger.error(error.stack);
            throw error;
        }
    }

    async getTotalSupply(): Promise<BigNumber>
    {
        const description = `total supply of contract at address ${this.contract.address}`;

        try
        {
            const result = await this.contract.totalSupply();
            const totalSupply: BigNumber = result[0]._bn;

            logger.info(`Got ${totalSupply.toString()} ${description}`);
            return totalSupply;
        }
        catch (err)
        {
            const error = new VError(err, `Could not get ${description}`);
            logger.error(error.stack);
            throw error;
        }
    }

    async getBalanceOf(address: string): Promise<BigNumber>
    {
        const description = `balance of address ${address} in contract at address ${this.contract.address}`;

        try
        {
            const result = await this.contract.balanceOf(address);
            const balance: BigNumber = result[0]._bn;

            logger.info(`Got ${balance} ${description}`);
            return balance;
        }
        catch (err)
        {
            const error = new VError(err, `Could not get ${description}`);
            logger.error(error.stack);
            throw error;
        }
    }

    async getEvents(eventName: string, fromBlock: number = 0): Promise<EventLog[]>
    {
        const description = `${eventName} events from block ${fromBlock} and contract address ${this.contract.address}`;

        const options = {
            fromBlock: fromBlock
        };

        try
        {
            logger.debug(`About to get ${description}`);

            const events = await this.web3Contract.getPastEvents(eventName, options);

            logger.debug(`${events.length} events successfully returned from ${description}`);

            return events;
        }
        catch (err)
        {
            const error = new VError(err, `Could not get ${description}`);
            console.log(error.stack);
            throw error;
        }
    }

    async getHolderBalances(): Promise<HolderBalances>
    {
        const description = `all token holder balances from contract address ${this.contract.address}`;

        try {
            const transferEvents = await this.getEvents("Transfer");

            const holderBalances: HolderBalances = {};

            transferEvents.forEach(event => {
                const fromAddress: string = event.returnValues.fromAddress,
                    toAddress: string = event.returnValues.toAddress,
                    amount: number = Number(event.returnValues.amount);
                //const {fromAddress: string, toAddress: string, amount: number } = event.returnValues;

                // if deposit
                if(fromAddress == '0x0000000000000000000000000000000000000000')
                {
                    holderBalances[toAddress] = (holderBalances[toAddress]) ?
                        holderBalances[toAddress] += amount :
                        holderBalances[toAddress] = amount;
                }
                // if withdrawal
                else if(toAddress == '0x0000000000000000000000000000000000000000')
                {
                    holderBalances[fromAddress] = (holderBalances[fromAddress]) ?
                        holderBalances[fromAddress] -= amount :
                        holderBalances[fromAddress] = -amount;
                }
                // if transfer
                else
                {
                    holderBalances[fromAddress] = (holderBalances[fromAddress]) ?
                        holderBalances[fromAddress] -= amount :
                        holderBalances[fromAddress] = -amount;

                    holderBalances[toAddress] = (holderBalances[toAddress]) ?
                        holderBalances[toAddress] += amount :
                        holderBalances[toAddress] = amount;
                }
            });

            return holderBalances;
        }
        catch(err) {
            const error = new VError(err, `Could not get ${description}`);
            console.log(error.stack);
            throw error;
        }
    }

    async processTransaction(hash: string, description: string, gas: number): Promise<TransactionReceipt>
    {
        // wait for the transaction to be mined
        const minedTransaction = await this.provider.waitForTransaction(hash);

        logger.debug(`${hash} mined in block number ${minedTransaction.blockNumber} for ${description}`);

        const transactionReceipt = await this.provider.getTransactionReceipt(hash);

        logger.debug(`Status ${transactionReceipt.status} and ${transactionReceipt.gasUsed} gas of ${gas} used for ${description}`);

        // If a status of 0 was returned then the transaction failed. Status 1 means the transaction worked
        if (transactionReceipt.status.eq(0)) {
            throw VError(`Failed ${hash} transaction with status code ${transactionReceipt.status} and ${gas} gas used.`);
        }

        return transactionReceipt;
    }
}

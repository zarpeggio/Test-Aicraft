const fs = require("fs");
const ethers = require("ethers");
const axios = require("axios");

// Load account details from JSON file
const account = JSON.parse(fs.readFileSync("account.json", "utf8"));
const { privateKey } = account;
const { bearerToken } = account;

// Ethereum provider & wallet
const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
const wallet = new ethers.Wallet(privateKey, provider);

// Contract details
const contractAddress = "0xd227d3bCE59b91380b7bc4A61A045B528B509439";
const abi = [
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "_candidateID",
          "type": "string"
        },
        {
          "internalType": "uint256",
          "name": "_feedAmount",
          "type": "uint256"
        },
        {
          "internalType": "string",
          "name": "_requestID",
          "type": "string"
        },
        {
          "internalType": "string",
          "name": "_requestData",
          "type": "string"
        },
        {
          "internalType": "bytes",
          "name": "_signature",
          "type": "bytes"
        },
        {
          "internalType": "bytes",
          "name": "_integritySignature",
          "type": "bytes"
        }
      ],
      "name": "feed",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
]

const contract = new ethers.Contract(contractAddress, abi, wallet);

// Get user data from API
async function getUserData(bearerToken) {
    try {
        const response = await fetch('https://api.aicraft.fun/users/me', {
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
            }
        });

        if (!response.ok) throw new Error(`Failed to fetch user data: ${response.status}`);
        
        const userData = await response.json();

        // Extract relevant information
        const walletID = userData.data.wallets[0]._id;
        const refCode = userData.data.invitedBy.refCode;
        const todayFeedCount = userData.data.todayFeedCount;

        const DAILY_FEED_LIMIT = 20;
        const remainingVotes = DAILY_FEED_LIMIT - todayFeedCount;
        console.log(`You have ${remainingVotes} votes remaining today!`);

        return {
            walletID,
            refCode,
            todayFeedCount
        };

    } catch (error) {
        console.error('Error fetching user data:', error);
        throw error;
    }
}


// 1. Create order through API
async function createOrder(orderData) {
    const requestBody = {
        candidateID: orderData.candidateID,
        chainID: orderData.chainID,
        feedAmount: orderData.feedAmount,
        refCode: orderData.refCode,
        walletID: orderData.walletID
    };

    try {
        const response = await fetch('https://api.aicraft.fun/feeds/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${bearerToken}`,
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();

    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

async function executeFeedTransaction(paymentResponse) {
    try {
        // Extract parameters from the nested structure
        const params = paymentResponse.data.payment.params;
        
        // Validate required parameters
        const requiredFields = [
            'candidateID', 
            'feedAmount', 
            'requestID', 
            'requestData',
            'userHashedMessage',
            'integritySignature'
        ];

        requiredFields.forEach(field => {
            if (!params[field]) {
                throw new Error(`Missing required field in payment params: ${field}`);
            }
        });

        // Convert hex signatures to bytes
        const signatureBytes = ethers.getBytes(params.userHashedMessage);
        const integritySignatureBytes = ethers.getBytes(params.integritySignature);

        // Prepare transaction parameters in ABI order
        const txParams = [
            String(params.candidateID),     // Explicit string conversion
            BigInt(params.feedAmount),      // Convert to BigInt
            String(params.requestID),       // Explicit string conversion
            JSON.stringify(JSON.parse(params.requestData)), // Normalize JSON
            signatureBytes,
            integritySignatureBytes
        ];

        // Estimate gas with buffer
        const gasEstimate = await contract.feed.estimateGas(...txParams);
        
        // Send transaction
        const tx = await contract.feed(...txParams, {
            gasLimit: gasEstimate * 12n / 10n,
            nonce: await provider.getTransactionCount(wallet.address),
            type: 2,
            maxPriorityFeePerGas: ethers.parseUnits('1.5', 'gwei'),
            maxFeePerGas: ethers.parseUnits('15', 'gwei')
        });

        console.log(`Transaction submitted: ${tx.hash}`);
        const receipt = await tx.wait(2);
        return receipt;

    } catch (error) {
        console.error('Full Error Details:', {
            message: error.message,
            code: error.code,
            data: error.data,
            stack: error.stack
        });
        throw error;
    }
}

// Main async function
async function main() {
    try {
        // 1. Get user data dynamically
        const { walletID, refCode } = await getUserData(bearerToken);
        
        console.log(`Wallet ID: ${walletID}`);
        console.log(`Referral Code: ${refCode}`);
        console.log('-'.repeat(40));

        // Define orderData with dynamic values
        const orderData = {
            candidateID: "67a9b5ccbb141fb88416656b",
            chainID: "10143",
            feedAmount: 1,
            refCode: refCode,  // Use dynamically fetched refCode
            walletID: walletID  // Use dynamically fetched walletID
        };

        // Step 1: Create order
        const orderResponse = await createOrder(orderData);
        console.log('Order created:', orderResponse);

        // Step 2: Execute transaction
        const receipt = await executeFeedTransaction(orderResponse);
        console.log({
            success: true,
            order: orderResponse,
            transactionHash: receipt.transactionHash,
            blockNumber: receipt.blockNumber
        });

    } catch (error) {
        console.error({
            success: false,
            error: error.message
        });
    }
}

// Execute the main function
main();
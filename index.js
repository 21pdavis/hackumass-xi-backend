// Created by @BatteryAcidDev
// This is the script that we upload to Lambda

// const { v4: uuidv4 } = require('uuid');
import { v4 as uuidv4 } from "uuid";
import {
    GameLiftClient,
    SearchGameSessionsCommand,
    DescribeGameSessionQueuesCommand,
    StartGameSessionPlacementCommand,
    CreatePlayerSessionCommand
} from "@aws-sdk/client-gamelift";
const gameLiftClient = new GameLiftClient({ region: 'us-east-1' });
const TARGET_GAMELIFT_QUEUE_NAME = "rtgl-queue-2022-1";
const REQUEST_FIND_MATCH = "1";
const MAX_PLAYER_COUNT = 2; // This can be updated to suit your game's requirements

async function searchGameSessions(targetAliasARN) {
    let gameSessionFilterExpression = "hasAvailablePlayerSessions=true";

    let searchGameSessionsRequest = {
        AliasId: targetAliasARN,
        FilterExpression: gameSessionFilterExpression,
        SortExpression: "creationTimeMillis ASC"
    }

    const command = new SearchGameSessionsCommand(searchGameSessionsRequest);
    try {
        const sessions = await gameLiftClient.send(command);
        console.log(`Sessions:\n${JSON.stringify(sessions, null, 2)}`);

        if (sessions.GameSessions && sessions.GameSessions.length > 0) {
            console.log("We have game sessions");
            return sessions.GameSessions[0]
        }
        else {
            console.log("No game sessions");
            return null;
        }
    }
    catch (error) {
        console.log(error);
        return null;
    }
}

async function getActiveQueue() {
    let options = {
        "Limit": 5 // how many GameLift queues to return
    }
    
    const command = new DescribeGameSessionQueuesCommand(options);
    try {
        const data = await gameLiftClient.send(command);

        if (data.GameSessionQueues && data.GameSessionQueues.length > 0) {
            // for now just grab the first Queue
            console.log("We have some queues");
            
            // if multiple queues, need to refactor this
            let selectedGameSessionQueue;
            data.GameSessionQueues.forEach(gameSessionQueue => {
                if (gameSessionQueue.Name == TARGET_GAMELIFT_QUEUE_NAME) {
                    selectedGameSessionQueue = gameSessionQueue;
                }
            });
            return selectedGameSessionQueue;
        }
        else {
            console.log("No queues available");
            return [];
        }
    }
    catch (error) {
        console.log(error);
        return [];
    }

}

async function createGameSessionPlacement(targetQueueName, playerId) {
    let createSessionInQueueRequest = {
        GameSessionQueueName: targetQueueName,
        PlacementId: uuidv4(), // generate unique placement id
        MaximumPlayerSessionCount: MAX_PLAYER_COUNT,
        DesiredPlayerSessions: [{
            PlayerId: playerId   
        }]
    };
    console.log("Calling startGameSessionPlacement...");

    const command = new StartGameSessionPlacementCommand(createSessionInQueueRequest);
    try {
        const data = await gameLiftClient.send(command);
        return data;
    }
    catch (error) {
        console.log(error);
        return [];
    }
}

async function createPlayerSession(playerId, gameSessionId) {
    let createPlayerSessionRequest = {
      GameSessionId: gameSessionId,
      PlayerId: playerId
    };
    
    const command = new CreatePlayerSessionCommand(createPlayerSessionRequest);
    try {
        return await gameLiftClient.send(command)
    }
    catch (error) {
        console.log(error);
        return null;
    }
}

// where the lambda execution starts
export const handler = async (event, context, callback) => {
    console.log("Inside function...");
    // console.log("environment: " + process.env.ENV);
    // console.log(JSON.stringify(event, null, 2));

    let message = JSON.parse(event.body);
    console.log("Message received: %j", message);
    
    let responseMsg = {};

    if (message && message.opCode) {

        switch (message.opCode) {
            case REQUEST_FIND_MATCH:
                console.log("Request find match opCode hit");

                let activeQueue = await getActiveQueue();
                // console.log(activeQueue);

                // The first destination is hardcoded here.  If you have more than one Alias or your setup is more complex, you’ll have to refactor. 
                let gameSession = await searchGameSessions(activeQueue.Destinations[0].DestinationArn);

                if (gameSession) { // Session found!
                    console.log("We have a game session to join!");
                    // console.log(gameSession);
                    
                    console.log("Creating player session...");
                    let playerSession = await createPlayerSession(message.playerId, gameSession.GameSessionId);
                    console.log("Player session created");
                    // console.log(playerSession);
                    
                    responseMsg = playerSession.PlayerSession;
                    responseMsg.PlayerSessionStatus = playerSession.PlayerSession.Status;
                    responseMsg.GameSessionId = gameSession.GameSessionId;
                    responseMsg.GameSessionStatus = gameSession.Status;
                    
                }
                else { // Session not found, must create!
                    console.log("No game sessions to join! " + activeQueue.Name);
                    let gameSessionPlacement = await createGameSessionPlacement(activeQueue.Name, message.playerId);
                    console.log("Game session placement request made");
                    // console.log(gameSessionPlacement.GameSessionPlacement);
                    responseMsg = gameSessionPlacement.GameSessionPlacement;
                }

                break;
        }
    }


    return callback(null, {
        statusCode: 200,
        body: JSON.stringify(
            responseMsg
        )
    });
};

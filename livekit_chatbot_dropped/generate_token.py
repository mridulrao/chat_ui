import os  
import json  
import uuid  
from fastapi import FastAPI, HTTPException  
from fastapi.middleware.cors import CORSMiddleware  
from pydantic import BaseModel  
from datetime import timedelta  
from livekit import api  
from dotenv import load_dotenv  
from livekit.api import RoomConfiguration, RoomAgentDispatch
load_dotenv()  
  
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")  
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")  
LIVEKIT_URL = os.getenv("LIVEKIT_URL")  
LIVEKIT_AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME")
LIVEKIT_PARTICIPANT_NAME = os.getenv("LIVEKIT_PARTICIPANT_NAME")
LIVEKIT_ROOM_NAME = os.getenv("LIVEKIT_ROOM_NAME")
LIVEKIT_PARTICIPANT_IDENTITY = os.getenv("LIVEKIT_PARTICIPANT_IDENTITY")
  
# Validate environment variables on startup  
if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:  
    raise ValueError("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set")  
if not LIVEKIT_URL:  
    raise ValueError("LIVEKIT_URL must be set")  
  
app = FastAPI()  
app.add_middleware(  
    CORSMiddleware,  
    allow_origins=["*"],  # dev-friendly; lock down for prod  
    allow_methods=["*"],  
    allow_headers=["*"],  
)  
  
class Participant(BaseModel):  
    identity: str  
    name: str | None = None  
  
class TokenReq(BaseModel):  
    participant: Participant  
    roomName: str  
    agentName: str | None = None  
  
@app.post("/token")  
def token():  
    try:  
        unique_room_name = f"{LIVEKIT_ROOM_NAME}-{uuid.uuid4().hex[:8]}"  
      
        at = (  
            api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)  
            .with_identity(LIVEKIT_PARTICIPANT_IDENTITY)  
            .with_name(LIVEKIT_PARTICIPANT_NAME)  
            .with_ttl(timedelta(hours=1))  
            .with_grants(  
                api.VideoGrants(  
                    room_join=True,  
                    room=unique_room_name,  # Use unique name  
                    can_publish=True,  
                    can_subscribe=True,  
                    can_publish_data=True,  
                )  
            )  
        )

        at = at.with_room_config(  
            api.RoomConfiguration(  
                agents=[  
                    api.RoomAgentDispatch(  
                        agent_name=LIVEKIT_AGENT_NAME, 
                        metadata="test-metadata"  
                    )  
                ],  
            )  
        )
            
        jwt = at.to_jwt()  
        return {"token": jwt, "url": LIVEKIT_URL}  
      
    except ValueError as e:  
        raise HTTPException(status_code=400, detail=str(e))  
    except Exception as e:  
        raise HTTPException(status_code=500, detail=f"Token generation failed: {str(e)}")  
  
if __name__ == "__main__":  
    import uvicorn  
    uvicorn.run(app, host="0.0.0.0", port=8000)
import logging   
import asyncio 
from dotenv import load_dotenv    
import os 
import uuid  
from livekit import api, rtc    
from livekit.agents import (  
    Agent,  
    AgentSession,  
    JobContext,  
    RoomInputOptions,  
    RoomOutputOptions,  
    WorkerOptions,  
    cli
)   
from livekit.plugins import openai
from livekit.agents.voice.room_io import TextInputEvent    
    
logger = logging.getLogger("text-only")    
logger.setLevel(logging.INFO)    
load_dotenv()  

LIVEKIT_AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME")
LIVEKIT_PARTICIPANT_IDENTITY = os.getenv("LIVEKIT_PARTICIPANT_IDENTITY")
    
class MyAgent(Agent):      
    def __init__(self) -> None:      
        super().__init__(      
            instructions="You are a helpful assistant.",  
            llm=openai.LLM(model="gpt-4o-mini"),  
            tts=None  # Explicitly set to None  
        )  
  
async def entrypoint(ctx: JobContext):  
    await ctx.connect()  
    logger.info(f"Connected to room: {ctx.room.name}")  
      
    session = AgentSession()  
      
    def custom_text_input_cb(sess: AgentSession, ev: TextInputEvent) -> None:  
        logger.info(f"Received text input from {ev.participant.identity}: {ev.text}")  
        sess.interrupt()  
        sess.generate_reply(user_input=ev.text)  
      
    # Listen for agent responses  
    @session.on("agent_speech_committed")  
    def on_agent_response(ev):  
        logger.info(f"Agent response: {ev.text}")  
        
        async def send_response():  
            await ctx.room.local_participant.publish_data(  
                ev.text.encode('utf-8'),  
                topic="chat"  
            )  
        
        asyncio.create_task(send_response()) 
      
    await session.start(  
        agent=MyAgent(),  
        room=ctx.room,  
        room_input_options=RoomInputOptions(  
            text_enabled=True,  
            audio_enabled=False,  
            participant_identity=LIVEKIT_PARTICIPANT_IDENTITY,  
            text_input_cb=custom_text_input_cb,  
            participant_kinds=[rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD]  
        ),  
        room_output_options=RoomOutputOptions(  
            transcription_enabled=False,  # Disable this  
            audio_enabled=False  
        ),  
    ) 
    
if __name__ == "__main__":    
    cli.run_app(WorkerOptions(  
        entrypoint_fnc=entrypoint, 
        agent_name=LIVEKIT_AGENT_NAME,
    ))
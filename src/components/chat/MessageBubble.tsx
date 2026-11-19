import type { ChatItem } from "../../stores/assistantStore";
import { PixelIcon } from "../retro/PixelIcon";

const formatTime = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function MessageBubble({ item }: { item: ChatItem }) {
  if (item.role === "note") {
    return (
      <div className="msg">
        <div className="msg__body">
          <div className={item.error ? "bubble bubble--error px selectable" : "bubble bubble--note px selectable"}>
            {item.text}
          </div>
        </div>
      </div>
    );
  }

  const mine = item.role === "user";
  const waiting = item.pending === true && item.text === "";
  const meta = [formatTime(item.at), mine && item.via === "voice" ? "by voice" : "", item.screenshot ? "screen attached" : ""]
    .filter(Boolean)
    .join("  -  ");

  return (
    <div className={mine ? "msg msg--user" : "msg"}>
      <div className="avatar">
        <PixelIcon name={mine ? "user" : "bot"} size={32} title={mine ? "You" : "ClickySketch"} />
      </div>
      <div className="msg__body">
        {waiting ? (
          <div className="bubble typing px" role="status" aria-label="ClickySketch is thinking">
            <i />
            <i />
            <i />
          </div>
        ) : (
          <div className={mine ? "bubble bubble--user px selectable" : "bubble px selectable"}>{item.text}</div>
        )}
        {item.screenshot ? <img className="msg__shot px" src={item.screenshot} alt="The screenshot that was sent with this question" /> : null}
        {!waiting ? <div className="msg__meta">{meta}</div> : null}
      </div>
    </div>
  );
}

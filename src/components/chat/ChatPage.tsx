import { useEffect, useRef } from "react";
import { useAssistantStore } from "../../stores/assistantStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
import { Welcome } from "./Welcome";

export function ChatPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const items = useAssistantStore((state) => state.items);
  const apiKey = useSettingsStore((state) => state.apiKey);
  const mic = useAssistantStore((state) => state.mic);
  const pane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = pane.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [items]);

  const empty = items.length === 0;
  const needsSetup = apiKey.trim() === "" || mic !== "granted";

  return (
    <div className="chat">
      <div ref={pane} className={empty ? "chat__pane chat__pane--empty px px--sunken" : "chat__pane px px--sunken"}>
        {empty ? (
          needsSetup ? (
            <Welcome hasKey={apiKey.trim() !== ""} onOpenSettings={onOpenSettings} />
          ) : (
            <section className="welcome px">
              <h2>Ready when you are</h2>
              <p>Hold the hotkey and ask about whatever is on your screen, or type below.</p>
            </section>
          )
        ) : (
          items.map((item) => <MessageBubble key={item.id} item={item} />)
        )}
      </div>
      <Composer />
    </div>
  );
}

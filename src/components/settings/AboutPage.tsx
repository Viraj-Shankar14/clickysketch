import { openExternal } from "../../services/desktopBridge";
import { Button } from "../retro/Button";
import { PixelIcon } from "../retro/PixelIcon";

export const APP_VERSION = "0.2.0";

export function AboutPage() {
  return (
    <div className="page">
      <div className="about">
        <section className="about__card px">
          <div className="about__logo">
            <PixelIcon name="logo" size={80} title="ClickySketch" />
          </div>
          <h2>ClickySketch</h2>
          <small>Version {APP_VERSION}</small>
          <p>A tutor that can see your screen, listens when you hold the hotkey, and answers out loud.</p>
          <p>
            <Button small onClick={() => void openExternal("https://openrouter.ai/google/gemma-4-26b-a4b-it:free")}>
              About the free model
            </Button>
            <Button small onClick={() => void openExternal("https://openrouter.ai/credits")}>
              Credits
            </Button>
          </p>
          <small>Type set in Pixelify Sans (SIL Open Font License). Voices come from your system.</small>
        </section>
      </div>
    </div>
  );
}

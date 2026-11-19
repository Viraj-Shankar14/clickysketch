//! Platform-independent push-to-talk state machine.
//!
//! The OS backends only report raw facts: which modifier keys are down, and when some *other* key
//! is pressed. Everything else (debouncing, "Ctrl+Alt+Del"-style combos cancelling a hold,
//! stuck-key recovery) lives here, so it behaves identically on Windows and macOS and can be unit
//! tested without touching the operating system.

use std::time::{Duration, Instant};

/// How long Ctrl+Alt must stay down before it counts as a push-to-talk hold. This filters out the
/// start of other shortcuts (Ctrl+Alt+T, Ctrl+Alt+Arrow, ...) without being perceptible.
pub const HOLD_DELAY: Duration = Duration::from_millis(90);

/// While a hold is active the real keyboard state is re-checked this often, so a key-up the OS
/// never delivered (secure desktop, lock screen) cannot leave the HUD stuck in "listening".
pub const RECONCILE_INTERVAL: Duration = Duration::from_millis(120);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Modifiers {
    pub ctrl: bool,
    /// Alt on Windows, Option on macOS.
    pub alt: bool,
    pub shift: bool,
    /// Windows key on Windows, Command on macOS.
    pub meta: bool,
}

impl Modifiers {
    /// True for exactly Ctrl + Alt/Option. A stray Shift or Win/Cmd means a different shortcut.
    pub fn is_chord(self) -> bool {
        self.ctrl && self.alt && !self.shift && !self.meta
    }
}

/// What the OS backends feed the state machine.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RawInput {
    /// The full set of modifier keys that are currently held.
    Modifiers(Modifiers),
    /// A non-modifier key went down.
    OtherKeyDown,
}

/// What the state machine tells the rest of the app.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PttPhase {
    Pressed,
    Released,
    /// Another key joined the chord mid-hold: it was a different shortcut, discard the recording.
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Idle,
    /// Chord is down but has not been held long enough to count yet.
    Arming { since: Instant },
    Active,
    /// A combo was detected; ignore everything until the chord is released.
    Tainted,
}

pub struct PttMachine {
    hold_delay: Duration,
    state: State,
    mods: Modifiers,
}

impl PttMachine {
    pub fn new(hold_delay: Duration) -> Self {
        Self { hold_delay, state: State::Idle, mods: Modifiers::default() }
    }

    /// True while a hold is arming or active, i.e. while stuck-key reconciliation is worthwhile.
    pub fn is_holding(&self) -> bool {
        matches!(self.state, State::Arming { .. } | State::Active)
    }

    /// When the machine next needs to be ticked (only while arming).
    pub fn next_deadline(&self) -> Option<Instant> {
        match self.state {
            State::Arming { since } => Some(since + self.hold_delay),
            _ => None,
        }
    }

    pub fn on_input(&mut self, input: RawInput, now: Instant) -> Option<PttPhase> {
        match input {
            RawInput::Modifiers(modifiers) => {
                self.mods = modifiers;
                self.on_modifiers(now)
            }
            RawInput::OtherKeyDown => self.on_other_key(),
        }
    }

    /// Promotes an arming hold to an active one once it has lasted long enough.
    pub fn tick(&mut self, now: Instant) -> Option<PttPhase> {
        if let State::Arming { since } = self.state {
            if now.saturating_duration_since(since) >= self.hold_delay {
                self.state = State::Active;
                return Some(PttPhase::Pressed);
            }
        }
        None
    }

    /// Stuck-key recovery: if the physical keyboard says the chord is gone while we still think a
    /// hold is in progress, release it.
    pub fn reconcile_release(&mut self, physical: Modifiers, now: Instant) -> Option<PttPhase> {
        if self.is_holding() && !physical.is_chord() {
            return self.on_input(RawInput::Modifiers(physical), now);
        }
        None
    }

    fn on_modifiers(&mut self, now: Instant) -> Option<PttPhase> {
        let chord = self.mods.is_chord();
        match self.state {
            State::Idle if chord => {
                self.state = State::Arming { since: now };
                None
            }
            State::Arming { .. } if !chord => {
                // Released before the hold delay elapsed: a tap, not a hold.
                self.state = State::Idle;
                None
            }
            State::Active if !chord => {
                self.state = State::Idle;
                Some(PttPhase::Released)
            }
            State::Tainted if !chord => {
                self.state = State::Idle;
                None
            }
            _ => None,
        }
    }

    fn on_other_key(&mut self) -> Option<PttPhase> {
        match self.state {
            State::Arming { .. } => {
                self.state = State::Tainted;
                None
            }
            State::Active => {
                self.state = State::Tainted;
                Some(PttPhase::Cancelled)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DELAY: Duration = Duration::from_millis(90);

    fn chord() -> RawInput {
        RawInput::Modifiers(Modifiers { ctrl: true, alt: true, shift: false, meta: false })
    }

    fn none() -> RawInput {
        RawInput::Modifiers(Modifiers::default())
    }

    fn ms(t0: Instant, n: u64) -> Instant {
        t0 + Duration::from_millis(n)
    }

    #[test]
    fn hold_then_release_emits_pressed_then_released() {
        let t0 = Instant::now();
        let mut m = PttMachine::new(DELAY);
        assert_eq!(m.on_input(chord(), t0), None);
        assert_eq!(m.next_deadline(), Some(t0 + DELAY));
        assert_eq!(m.tick(ms(t0, 50)), None);
        assert_eq!(m.tick(ms(t0, 90)), Some(PttPhase::Pressed));
        assert!(m.is_holding());
        assert_eq!(m.on_input(none(), ms(t0, 900)), Some(PttPhase::Released));
        assert!(!m.is_holding());
    }

    #[test]
    fn a_quick_tap_is_ignored() {
        let t0 = Instant::now();
        let mut m = PttMachine::new(DELAY);
        m.on_input(chord(), t0);
        assert_eq!(m.on_input(none(), ms(t0, 40)), None);
        assert_eq!(m.tick(ms(t0, 500)), None);
    }

    #[test]
    fn another_key_while_arming_turns_it_into_a_different_shortcut() {
        let t0 = Instant::now();
        let mut m = PttMachine::new(DELAY);
        m.on_input(chord(), t0);
        assert_eq!(m.on_input(RawInput::OtherKeyDown, ms(t0, 30)), None);
        assert_eq!(m.tick(ms(t0, 400)), None);
        // Still holding the chord afterwards must not re-trigger...
        assert_eq!(m.on_input(chord(), ms(t0, 500)), None);
        assert_eq!(m.tick(ms(t0, 900)), None);
        // ...but releasing and pressing again must work.
        assert_eq!(m.on_input(none(), ms(t0, 1000)), None);
        m.on_input(chord(), ms(t0, 1100));
        assert_eq!(m.tick(ms(t0, 1200)), Some(PttPhase::Pressed));
    }

    #[test]
    fn another_key_during_a_hold_cancels_it_exactly_once() {
        let t0 = Instant::now();
        let mut m = PttMachine::new(DELAY);
        m.on_input(chord(), t0);
        m.tick(ms(t0, 100));
        assert_eq!(m.on_input(RawInput::OtherKeyDown, ms(t0, 300)), Some(PttPhase::Cancelled));
        assert_eq!(m.on_input(RawInput::OtherKeyDown, ms(t0, 310)), None);
        assert_eq!(m.on_input(none(), ms(t0, 500)), None);
    }

    #[test]
    fn extra_modifiers_never_form_the_chord() {
        let t0 = Instant::now();
        let mut m = PttMachine::new(DELAY);
        let with_shift = RawInput::Modifiers(Modifiers { ctrl: true, alt: true, shift: true, meta: false });
        let with_meta = RawInput::Modifiers(Modifiers { ctrl: true, alt: true, shift: false, meta: true });
        assert_eq!(m.on_input(with_shift, t0), None);
        assert_eq!(m.on_input(with_meta, ms(t0, 10)), None);
        assert_eq!(m.tick(ms(t0, 1000)), None);
        assert!(!m.is_holding());
    }

    #[test]
    fn dropping_a_modifier_mid_hold_releases() {
        let t0 = Instant::now();
        let mut m = PttMachine::new(DELAY);
        m.on_input(chord(), t0);
        m.tick(ms(t0, 100));
        let only_ctrl = RawInput::Modifiers(Modifiers { ctrl: true, ..Modifiers::default() });
        assert_eq!(m.on_input(only_ctrl, ms(t0, 400)), Some(PttPhase::Released));
    }

    #[test]
    fn reconcile_releases_a_stuck_hold_but_never_starts_one() {
        let t0 = Instant::now();
        let mut m = PttMachine::new(DELAY);
        // Nothing is held: a "physical" chord must not start anything.
        let physical_chord = Modifiers { ctrl: true, alt: true, shift: false, meta: false };
        assert_eq!(m.reconcile_release(physical_chord, t0), None);
        assert!(!m.is_holding());

        m.on_input(chord(), t0);
        m.tick(ms(t0, 100));
        // The OS lost the key-up, but the physical keyboard says the keys are up.
        assert_eq!(m.reconcile_release(Modifiers::default(), ms(t0, 500)), Some(PttPhase::Released));
        assert!(!m.is_holding());
    }
}

# Requirements Document

## Introduction

Kiro is an AI-powered desktop accessibility assistant for Windows, designed specifically for older adults who struggle with common computer problems. The assistant listens to natural-language voice or text input, observes the screen, interprets the user's intent, and safely executes a predefined set of system actions — then explains what it did in a calm, reassuring voice. The guiding principle is: don't teach the user how to use the computer, just fix it for them.

The system prioritizes safety, reversibility, and trust above all else. It never performs dangerous or irreversible actions without explicit confirmation, never interacts with payment or password fields, and always selects from a fixed catalog of approved actions rather than generating arbitrary code.

---

## Glossary

- **Assistant**: The Kiro AI-powered desktop accessibility assistant application.
- **User**: The senior adult operating the Windows desktop.
- **Action_Catalog**: The fixed, predefined set of approved system actions the Assistant may execute.
- **Action**: A single entry in the Action_Catalog with a name, description, parameters, safety level, and undo capability.
- **Intent_Engine**: The LLM-based component that maps user input and screen context to a selected Action.
- **Voice_Input**: The speech-to-text subsystem (Whisper) that converts spoken audio to text.
- **TTS_Engine**: The text-to-speech subsystem that converts Assistant responses to spoken audio.
- **Screen_Observer**: The component that captures screenshots and extracts UI context via vision model and OCR.
- **Action_Executor**: The component that carries out a selected Action via system automation APIs.
- **Confirmation_Dialog**: A UI element that presents the intended action to the user before execution.
- **Undo_Manager**: The component that tracks reversible actions and restores prior state on request.
- **App_Catalog**: The indexed mapping of friendly application names to executable paths on the system.
- **Scam_Detector**: The component that identifies suspicious popups, fake virus warnings, and scam indicators on screen.
- **Family_Channel**: The optional communication pathway for sending screenshots or summaries to a designated family contact.
- **Safety_Level**: A classification of each Action as `low`, `medium`, or `high` risk.
- **Floating_UI**: The persistent, always-on-top overlay window through which the User interacts with the Assistant.
- **System_Tray**: The Windows notification area icon providing quick access to the Assistant.
- **Tool_Catalog**: The fixed set of low-level, parameterized system commands available to the Action_Executor. Tool_Catalog entries are not directly selectable by the LLM; they are invoked only by the Action_Executor as part of carrying out an Action.
- **Command_Logger**: The component responsible for recording every Tool_Catalog execution with a timestamp, tool name, and sanitized parameters in a local, human-readable log file.
- **Microphone_Test**: A guided audio check performed during onboarding that confirms the microphone is receiving input and that the Voice_Input subsystem can transcribe speech, providing both spoken and visual confirmation to the user.
- **Push_To_Talk**: An optional interaction mode in which the user holds a visible button in the Floating_UI to activate listening, as an alternative to the always-on wake-word mode.
- **Language_Mapping**: A structured, editable synonym and phrase mapping layer that maps common user-friendly phrases to specific Action_Catalog entries, consulted by the Intent_Engine before invoking the LLM.

---

## Requirements

### Requirement 1: Voice and Text Input

**User Story:** As a senior user, I want to speak naturally to the assistant or type my request, so that I can ask for help without learning special commands or syntax.

#### Acceptance Criteria

1. THE Voice_Input SHALL convert spoken audio to text using streaming speech recognition with a latency of no more than 2 seconds from end of speech to text availability.
2. WHEN the user speaks, THE Voice_Input SHALL begin transcription without requiring the user to press any button, using always-on listening mode activated by a configurable wake word.
3. WHERE the user prefers text input, THE Assistant SHALL accept typed natural-language requests through a visible text field in the Floating_UI.
4. IF the Voice_Input fails to produce a transcription within 5 seconds of speech ending, THEN THE Assistant SHALL prompt the user to repeat their request using a calm spoken message.
5. THE Assistant SHALL accept requests in plain, conversational English without requiring specific phrasing or command syntax.
6. THE Voice_Input SHALL tolerate slow speech, long pauses between words, and incomplete sentences without prematurely cutting off or discarding the user's input before the user has finished speaking.

---

### Requirement 2: Screen Observation and Context Extraction

**User Story:** As a senior user, I want the assistant to see what's on my screen, so that it can understand my problem without me having to describe every detail.

#### Acceptance Criteria

1. WHEN the user submits a request, THE Screen_Observer SHALL capture a screenshot of the current desktop state within 500 milliseconds.
2. THE Screen_Observer SHALL extract visible text from the screenshot using OCR and provide it to the Intent_Engine as context.
3. THE Screen_Observer SHALL identify the foreground application, open windows, and visible UI elements and include this information in the context passed to the Intent_Engine.
4. WHEN the Screen_Observer detects a visible popup or dialog, THE Screen_Observer SHALL classify it as either a system dialog, application dialog, or suspicious popup and include this classification in the context.
5. IF a screenshot cannot be captured due to a system permission error, THEN THE Assistant SHALL notify the user with a spoken message and proceed using only the user's verbal description.

---

### Requirement 3: Intent Interpretation

**User Story:** As a senior user, I want the assistant to understand what I mean even when I use informal or imprecise language, so that I don't have to know the correct technical terms.

#### Acceptance Criteria

1. WHEN the user submits a request, THE Intent_Engine SHALL map the request to exactly one Action from the Action_Catalog or to a clarification response if no suitable Action exists.
2. THE Intent_Engine SHALL resolve informal application references (e.g., "that blue internet thing", "my email") to specific entries in the App_Catalog.
3. WHEN the Intent_Engine cannot determine the user's intent with sufficient confidence, THE Intent_Engine SHALL ask the user one clarifying question rather than guessing or failing silently.
4. THE Intent_Engine SHALL use both the user's text input and the Screen_Observer context together when selecting an Action.
5. IF the user's request maps to an Action with Safety_Level of `high`, THEN THE Intent_Engine SHALL require explicit user confirmation before passing the Action to the Action_Executor.
6. THE Intent_Engine SHALL complete intent resolution and Action selection within 3 seconds of receiving the user's request and screen context.

---

### Requirement 4: Action Catalog and Execution

**User Story:** As a senior user, I want the assistant to fix my problem directly, so that I don't have to follow instructions or navigate menus myself.

#### Acceptance Criteria

1. THE Action_Catalog SHALL contain predefined Actions covering at minimum: `set_volume`, `set_brightness`, `increase_text_size`, `decrease_text_size`, `toggle_dark_mode`, `set_cursor_size`, `open_app`, `close_window`, `bring_window_to_focus`, `take_screenshot`, `read_screen_aloud`, `rotate_screen`, `create_desktop_shortcut`, `find_file`.
2. THE Action_Executor SHALL only execute Actions that exist in the Action_Catalog and SHALL reject any instruction that does not correspond to a catalog entry.
3. WHEN an Action is executed, THE Action_Executor SHALL complete the action within 3 seconds for Actions with Safety_Level `low` or `medium`.
4. THE Action_Executor SHALL use Windows system APIs and approved automation libraries to carry out Actions and SHALL NOT execute arbitrary shell commands or scripts generated at runtime.
5. IF an Action execution fails, THEN THE Action_Executor SHALL report the failure to the Assistant, which SHALL inform the user with a calm spoken explanation and suggest an alternative if one exists.
6. THE Action_Catalog SHALL classify each Action with a Safety_Level of `low`, `medium`, or `high` and SHALL document whether the Action supports undo.

---

### Requirement 5: Safety Constraints and Confirmation

**User Story:** As a senior user and as a family member, I want the assistant to never perform dangerous or irreversible actions without my explicit approval, so that I can trust it completely.

#### Acceptance Criteria

1. THE Assistant SHALL never interact with UI elements classified as password fields, payment fields, or financial transaction controls.
2. THE Assistant SHALL never execute Actions labeled `buy`, `pay`, `send money`, `confirm payment`, or any Action that initiates a financial transaction.
3. WHEN an Action has Safety_Level `medium` or `high`, THE Assistant SHALL display a Confirmation_Dialog describing the intended action in plain language before execution.
4. THE Confirmation_Dialog SHALL present the user with a clearly labeled "Go ahead" option and a clearly labeled "Cancel" option, both accessible via voice command and mouse click.
5. IF the user does not respond to a Confirmation_Dialog within 30 seconds, THEN THE Assistant SHALL cancel the pending Action and inform the user with a spoken message.
6. THE Assistant SHALL treat all visible financial, medical, and legal document content as read-only and SHALL NOT modify, submit, or interact with such content.
7. WHEN the user requests an action the Assistant is uncertain about, THE Assistant SHALL ask for confirmation rather than proceeding with a best-guess interpretation.

---

### Requirement 6: Undo and Reversibility

**User Story:** As a senior user, I want to be able to undo what the assistant just did, so that I feel safe letting it make changes.

#### Acceptance Criteria

1. THE Undo_Manager SHALL record the prior system state before executing any Action that supports undo, as defined in the Action_Catalog.
2. WHEN the user says "undo that" or "put it back", THE Undo_Manager SHALL restore the system to the state recorded before the most recent reversible Action.
3. THE Assistant SHALL inform the user after each Action whether the action can be undone, using a brief spoken statement.
4. THE Undo_Manager SHALL retain undo state for the most recent 10 reversible Actions within a single session.
5. IF an Action does not support undo, THEN THE Assistant SHALL state this clearly in the Confirmation_Dialog before the user approves execution.

---

### Requirement 7: Scam and Threat Detection

**User Story:** As a senior user, I want the assistant to protect me from scary or fake messages on my screen, so that I don't accidentally fall for a scam.

#### Acceptance Criteria

1. WHEN the Screen_Observer captures a screenshot, THE Scam_Detector SHALL analyze visible popups and dialogs for indicators of scam content, including fake virus warnings, urgent payment demands, and impersonation of system alerts.
2. WHEN the Scam_Detector identifies a suspicious popup with high confidence, THE Assistant SHALL immediately inform the user with a calm spoken message such as "That message looks suspicious. It is not real. You are safe."
3. WHEN the Scam_Detector identifies a suspicious popup, THE Assistant SHALL offer to close the popup on the user's behalf using the `close_window` Action.
4. THE Scam_Detector SHALL NOT automatically close any window without the user's verbal or click-based confirmation.
5. IF the Scam_Detector is uncertain whether a popup is malicious, THEN THE Scam_Detector SHALL flag it as suspicious and present it to the user for a decision rather than acting autonomously.
6. THE Scam_Detector SHALL recognize at minimum the following scam patterns: fake Microsoft/Windows security alerts, fake antivirus warnings, tech support scam overlays, and urgent payment demand dialogs.

---

### Requirement 8: Text-to-Speech Responses

**User Story:** As a senior user, I want the assistant to speak its responses aloud in a calm, friendly voice, so that I don't have to read small text on the screen.

#### Acceptance Criteria

1. THE TTS_Engine SHALL convert all Assistant responses to spoken audio using a warm, calm voice.
2. THE TTS_Engine SHALL begin speaking a response within 1 second of the response text being available.
3. THE Assistant SHALL use plain, non-technical language in all spoken responses and SHALL avoid jargon, error codes, and technical terminology.
4. WHEN the Assistant completes an action, THE TTS_Engine SHALL speak a brief confirmation in the first person, such as "I've made the text a bit bigger for you."
5. THE TTS_Engine SHALL support a configurable speech rate, with a default rate appropriate for older adults (approximately 130–150 words per minute).
6. WHEN the user says "stop" or "quiet", THE TTS_Engine SHALL immediately stop speaking.

---

### Requirement 9: Floating UI and System Tray

**User Story:** As a senior user, I want a simple, always-visible interface that I can use without hunting for it, so that I can always find the assistant when I need help.

#### Acceptance Criteria

1. THE Floating_UI SHALL remain visible on top of all other windows at all times unless the user explicitly minimizes it.
2. THE Floating_UI SHALL use a high-contrast color scheme, a minimum font size of 18pt, and large interactive controls with a minimum touch/click target size of 44×44 pixels.
3. THE Floating_UI SHALL display the current listening state (idle, listening, thinking, speaking) using both a visual indicator and a text label.
4. THE Assistant SHALL place an icon in the System_Tray that allows the user to show, hide, or exit the Floating_UI.
5. WHEN the Floating_UI is minimized, THE Assistant SHALL continue listening for the wake word and SHALL restore the Floating_UI automatically when a request is detected.
6. THE Floating_UI SHALL display the most recent Assistant response as text in addition to speaking it aloud.
7. THE Floating_UI SHALL provide a clearly labeled "Undo" button that triggers the most recent reversible action's undo operation.

---

### Requirement 10: Application Discovery and App Catalog

**User Story:** As a senior user, I want the assistant to know what programs are on my computer so it can open them when I ask, even if I don't know the exact name.

#### Acceptance Criteria

1. WHEN the Assistant starts for the first time, THE App_Catalog SHALL scan the Windows system for installed applications by searching standard installation directories and the Windows registry.
2. THE App_Catalog SHALL map at least 20 common friendly name aliases (e.g., "internet", "browser", "email", "photos", "music") to their corresponding executable paths.
3. WHEN the user requests to open an application using an informal name, THE Intent_Engine SHALL query the App_Catalog and select the best matching application.
4. IF the App_Catalog cannot find a match for the user's requested application, THEN THE Assistant SHALL inform the user that the application was not found and ask if they can describe it differently.
5. THE App_Catalog SHALL refresh its index once per day to account for newly installed or removed applications.
6. THE App_Catalog SHALL store the application index locally on disk and SHALL load it at startup without requiring a full rescan each time.

---

### Requirement 11: Screen Reading and Narration

**User Story:** As a senior user, I want the assistant to read what's on my screen aloud, so that I can understand content without straining to read small text.

#### Acceptance Criteria

1. WHEN the user requests "read the screen" or equivalent, THE Screen_Observer SHALL capture a screenshot and THE Assistant SHALL narrate the primary visible content in plain language.
2. THE Assistant SHALL summarize screen content rather than reading every word verbatim, focusing on the most relevant information for the user's context.
3. WHEN reading a document or article, THE Assistant SHALL read the main body text from top to bottom, skipping navigation menus and advertisements.
4. THE Assistant SHALL complete screen reading narration within 5 seconds of the user's request for typical screen content.
5. WHEN the user says "stop reading", THE TTS_Engine SHALL immediately stop the narration.

---

### Requirement 12: Family Communication Channel

**User Story:** As a senior user, I want to be able to send a message or screenshot to my family member, so that I can get help from them when the assistant can't solve my problem.

#### Acceptance Criteria

1. WHERE the Family_Channel is configured, THE Assistant SHALL support a "send this to my daughter/son/family" voice command that shares the current screenshot and a brief context summary.
2. THE Assistant SHALL require explicit user confirmation before sending any message or screenshot through the Family_Channel.
3. THE Family_Channel SHALL support at minimum one pre-configured recipient (name and contact method) set up during initial onboarding.
4. WHEN a message is sent through the Family_Channel, THE Assistant SHALL confirm the send with a spoken message such as "I've sent a message to Sarah for you."
5. IF the Family_Channel is not configured, THEN THE Assistant SHALL inform the user that this feature needs to be set up and offer to guide them through setup.
6. THE Assistant SHALL never send messages, screenshots, or personal data through the Family_Channel without explicit per-message user confirmation.

---

### Requirement 13: Performance and Responsiveness

**User Story:** As a senior user, I want the assistant to respond quickly so that I don't feel like something is broken while I wait.

#### Acceptance Criteria

1. THE Assistant SHALL complete the full cycle from end of user speech to start of spoken response within 3 seconds for Actions with Safety_Level `low`.
2. THE Assistant SHALL provide a spoken acknowledgment such as "Let me take a look" within 1 second of receiving any request, even if the full response is not yet ready.
3. WHILE the Assistant is processing a request, THE Floating_UI SHALL display a visible activity indicator so the user knows the Assistant is working.
4. THE Assistant SHALL remain responsive to new voice input at all times, including while executing an Action or speaking a response.
5. THE Assistant SHALL operate with a memory footprint of no more than 500 MB of RAM during normal operation to avoid degrading system performance on older hardware.

---

### Requirement 14: Offline and Fallback Operation

**User Story:** As a senior user, I want the assistant to still help me with basic tasks even when my internet is not working, so that I'm not left helpless.

#### Acceptance Criteria

1. WHEN the internet connection is unavailable, THE Assistant SHALL continue to execute all Actions in the Action_Catalog that do not require external API calls.
2. WHEN the internet connection is unavailable, THE Assistant SHALL notify the user once with a spoken message that some features (such as AI understanding) may be limited.
3. THE Assistant SHALL use a local fallback speech recognition model when the primary cloud-based Voice_Input is unavailable.
4. THE Assistant SHALL use a local TTS voice when the cloud-based TTS_Engine is unavailable, maintaining spoken output at all times.
5. IF the Intent_Engine cannot reach the LLM API, THEN THE Assistant SHALL fall back to a local keyword-matching ruleset for the 20 most common user requests.

---

### Requirement 15: Onboarding and Initial Setup

**User Story:** As a senior user or family member setting up the assistant, I want a simple guided setup process, so that the assistant is ready to use without technical knowledge.

#### Acceptance Criteria

1. WHEN the Assistant is launched for the first time, THE Assistant SHALL guide the user through an onboarding flow using spoken instructions and large on-screen prompts.
2. THE onboarding flow SHALL configure at minimum: wake word selection or confirmation, microphone permission, and optional Family_Channel recipient.
3. THE onboarding flow SHALL complete in no more than 5 steps, each requiring only a single voice or click response from the user.
4. WHEN onboarding is complete, THE Assistant SHALL perform a brief demonstration of its core capabilities using a sample interaction.
5. THE Assistant SHALL allow the user to re-run the onboarding flow at any time from the System_Tray menu.


---

### Requirement 16: Voice Interaction Accessibility

**User Story:** As a senior user with slow or hesitant speech, I want the assistant to listen patiently and confirm it heard me correctly, so that I feel confident using voice input without fear of being misunderstood or cut off.

#### Acceptance Criteria

1. WHEN the Assistant is launched for the first time, THE Microphone_Test SHALL play a spoken prompt asking the user to say a short phrase and SHALL display a visual confirmation (e.g., animated waveform and "I heard you!") once the phrase is successfully transcribed.
2. IF the Microphone_Test does not detect audio input within 15 seconds, THEN THE Assistant SHALL display a troubleshooting prompt in large text and offer to proceed with text-only input.
3. WHEN the Assistant is in listening mode, THE Floating_UI SHALL display a large, clearly labeled "Listening…" indicator using both a prominent visual state change and a text label visible at a minimum font size of 24pt.
4. WHERE the user has enabled audio cues, THE Assistant SHALL play a distinct, non-startling sound when listening begins and a separate sound when listening ends.
5. THE Voice_Input SHALL tolerate slow speech, long pauses between words, and incomplete sentences without prematurely cutting off or discarding the user's input before the user has finished speaking.
6. WHEN the Voice_Input transcription confidence is below the configured threshold, THE Assistant SHALL repeat the transcribed phrase back to the user and ask "Did you mean: [phrase]?" before proceeding.
7. THE Assistant SHALL recognize and respond to the following voice control commands at all times: "stop", "cancel", "go back", "say that again", and "listen again".
8. WHERE the user prefers Push_To_Talk, THE Floating_UI SHALL display a clearly labeled button that activates listening only while held or toggled, as an alternative to always-on wake-word mode.
9. THE Assistant SHALL always provide a visible text input field in the Floating_UI as a fallback interaction mode, regardless of microphone availability.
10. WHEN the Assistant receives a request and processing will take more than 1 second, THE TTS_Engine SHALL immediately speak an acknowledgment such as "I'm listening" or "Let me check that" to prevent user uncertainty during processing.
11. THE Voice_Input subsystem SHALL tolerate moderate background audio (e.g., television at conversational volume) without triggering false wake-word activations more than once per hour under typical home conditions.

---

### Requirement 17: System Command and Tooling Layer

**User Story:** As a system designer, I want a controlled, auditable command execution layer beneath the Action_Catalog, so that all low-level system interactions are predefined, parameterized, and never constructed from user input at runtime.

#### Acceptance Criteria

1. THE Tool_Catalog SHALL contain a fixed set of predefined, parameterized system commands including at minimum: `scan_installed_applications`, `query_display_settings`, `get_volume_level`, `set_volume_level`, `enumerate_running_processes`, `read_registry_value`, `list_start_menu_entries`, and `list_program_files_directories`.
2. THE Action_Executor SHALL be the only component permitted to invoke Tool_Catalog entries; THE Intent_Engine and LLM SHALL NOT directly select or invoke tools.
3. THE Action_Executor SHALL validate all parameters passed to a Tool_Catalog entry against a defined type and value schema before execution, and SHALL reject any invocation where parameters fail validation.
4. THE Action_Executor SHALL NOT construct shell commands or script strings dynamically from user input; all Tool_Catalog entries SHALL use parameterized invocation patterns (e.g., PowerShell cmdlets with typed arguments or Windows API calls).
5. WHEN a Tool_Catalog entry is executed, THE Command_Logger SHALL record a log entry containing: timestamp, tool name, sanitized parameter values, and execution outcome (success or failure code).
6. THE Command_Logger SHALL write log entries to a local, human-readable plain-text file and SHALL retain logs for a minimum of 30 days before automatic rotation.
7. THE App_Catalog scanning process SHALL use the `scan_installed_applications`, `list_start_menu_entries`, `list_program_files_directories`, and `read_registry_value` tools to discover installed applications across Start Menu shortcuts, the Windows registry (`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`), and standard Program Files directories.
8. THE App_Catalog SHALL normalize discovered application entries into a consistent alias-to-executable mapping, deduplicating entries that refer to the same executable path.
9. IF a Tool_Catalog entry fails due to a system permission error, THEN THE Action_Executor SHALL log the failure via the Command_Logger and report the error to the Assistant without retrying automatically.
10. THE Tool_Catalog SHALL be defined in a static configuration file that is loaded at startup; new tools SHALL NOT be added or modified at runtime.

---

### Requirement 18: User Language Mapping

**User Story:** As a senior user, I want the assistant to understand the everyday phrases I naturally use to describe what I want, so that common requests are recognized instantly without relying solely on AI interpretation.

#### Acceptance Criteria

1. THE Language_Mapping SHALL define a structured, editable mapping of user-friendly phrases and synonyms to Action_Catalog entries, including at minimum: "take a picture of my screen" → `take_screenshot`, "make it louder" → `set_volume`, "turn it up" → `set_volume`, "I can't see anything" → `increase_text_size` or `set_brightness`, "open the internet" → `open_app`, and "make the writing bigger" → `increase_text_size`.
2. WHEN the Intent_Engine receives user input, THE Intent_Engine SHALL consult the Language_Mapping before passing the input to the LLM, and SHALL use the mapped Action directly if a match is found with sufficient confidence.
3. THE Language_Mapping SHALL be stored in a structured, human-readable configuration file (e.g., JSON or YAML) that can be edited without modifying application code or recompiling the Assistant.
4. THE Language_Mapping SHALL support multiple synonym phrases per Action_Catalog entry and SHALL allow partial phrase matching for common variations.
5. WHEN a Language_Mapping match is used to resolve a request, THE Intent_Engine SHALL log the matched phrase and the resolved Action to support future mapping improvements.
6. THE Command_Logger SHALL record Language_Mapping usage events with the matched phrase (anonymized of any personal content) and the resolved Action, so that unmapped phrases can be identified and added in future updates.
7. IF no Language_Mapping match is found, THEN THE Intent_Engine SHALL proceed to LLM-based intent resolution as defined in Requirement 3.
8. THE Language_Mapping configuration file SHALL be reloadable at runtime without restarting the Assistant, allowing updates to take effect immediately after the file is saved.

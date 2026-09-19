import { Schema } from "effect"

export class LockTimeout extends Schema.TaggedError<LockTimeout>()("LockTimeout", {
  path: Schema.String,
}) {}

export class WrongPluginId extends Schema.TaggedError<WrongPluginId>()("WrongPluginId", {
  registeredId: Schema.String,
}) {}

export class WindowManagerPending extends Schema.TaggedError<WindowManagerPending>()(
  "WindowManagerPending",
  { command: Schema.String },
) {}

export class UnknownCommand extends Schema.TaggedError<UnknownCommand>()("UnknownCommand", {
  command: Schema.String,
}) {}

export class UnimplementedCommand extends Schema.TaggedError<UnimplementedCommand>()(
  "UnimplementedCommand",
  { command: Schema.String },
) {}

export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  command: Schema.String,
  message: Schema.String,
}) {}

export class RpcTransportError extends Schema.TaggedError<RpcTransportError>()("RpcTransportError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export class NotATty extends Schema.TaggedError<NotATty>()("NotATty", {}) {}

export class FlockError extends Schema.TaggedError<FlockError>()("FlockError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class TomlEditError extends Schema.TaggedError<TomlEditError>()("TomlEditError", {
  message: Schema.String,
}) {}

export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
  message: Schema.String,
}) {}

export class LabelRulesError extends Schema.TaggedError<LabelRulesError>()("LabelRulesError", {
  message: Schema.String,
}) {}

export class MigrationError extends Schema.TaggedError<MigrationError>()("MigrationError", {
  message: Schema.String,
}) {}

export class LayoutError extends Schema.TaggedError<LayoutError>()("LayoutError", {
  message: Schema.String,
}) {}

export class PaneMoveError extends Schema.TaggedError<PaneMoveError>()("PaneMoveError", {
  message: Schema.String,
}) {}

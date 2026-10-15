//! Browser bindings and a Rust-owned parameter editor. JavaScript only hosts the component.
use engineering_core::{block, units};
use js_sys::Function;
use wasm_bindgen::prelude::*;
fn diagnostic_text(value: &JsValue) -> String {
    value
        .as_string()
        .or_else(|| {
            value
                .dyn_ref::<js_sys::Error>()
                .and_then(|e| e.message().as_string())
        })
        .unwrap_or_else(|| "The change could not be applied.".into())
}
fn error(message: impl ToString) -> JsValue {
    js_sys::Error::new(&message.to_string()).into()
}
fn json<T: serde::Serialize>(value: &T) -> Result<String, JsValue> {
    serde_json::to_string(value).map_err(error)
}
#[wasm_bindgen]
pub fn runtime_version() -> String {
    format!(
        "HammerCraft Rust {} · WebAssembly",
        engineering_core::VERSION
    )
}
#[wasm_bindgen]
pub fn evaluate_expression(expression: &str, resolver: &Function) -> Result<String, JsValue> {
    let value = units::evaluate(expression, &mut |name| {
        let result = resolver
            .call1(&JsValue::NULL, &JsValue::from_str(name))
            .map_err(|e| {
                e.as_string()
                    .unwrap_or_else(|| "Parameter resolver failed.".into())
            })?;
        if result.is_null() || result.is_undefined() {
            return Ok(None);
        }
        let text = js_sys::JSON::stringify(&result)
            .map_err(|_| "Invalid resolved quantity.")?
            .as_string()
            .ok_or("Invalid resolved quantity.")?;
        serde_json::from_str(&text)
            .map(Some)
            .map_err(|_| "Invalid resolved quantity.".into())
    })
    .map_err(error)?;
    json(&value)
}
#[wasm_bindgen]
pub fn resolve_parameters(input: &str) -> Result<String, JsValue> {
    let list: Vec<units::Parameter> = serde_json::from_str(input).map_err(error)?;
    json(&units::parameters(&list).map_err(error)?)
}
#[wasm_bindgen]
pub fn solve_block(input: &str, progress: &Function) -> Result<String, JsValue> {
    let q: block::Request = serde_json::from_str(input).map_err(error)?;
    let solution = block::solve(&q, &mut |iterations, residual| {
        let _ = progress.call2(
            &JsValue::NULL,
            &JsValue::from_f64(iterations as f64),
            &JsValue::from_f64(residual),
        );
    })
    .map_err(error)?;
    json(&solution)
}
#[wasm_bindgen]
pub fn solve_thermal_tetra(input: &str) -> Result<String, JsValue> {
    let q = serde_json::from_str(input).map_err(error)?;
    json(&engineering_core::conduction::solve_thermal(&q, &mut |_| {}).map_err(error)?)
}

use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::JsCast;
use web_sys::{Document, Element, Event, HtmlInputElement};
fn el(doc: &Document, tag: &str, text: &str, class: &str) -> Result<Element, JsValue> {
    let e = doc.create_element(tag)?;
    e.set_text_content(Some(text));
    if !class.is_empty() {
        e.set_class_name(class);
    }
    Ok(e)
}
struct Row {
    wrapper: Element,
    id: String,
    name: HtmlInputElement,
    expression: HtmlInputElement,
}
fn row(
    doc: &Document,
    parent: &Element,
    p: &units::Parameter,
    value: Option<&units::Quantity>,
) -> Result<Row, JsValue> {
    let wrapper = el(doc, "div", "", "parameter-row")?;
    let input = |label: &str, value: &str, max: i32| -> Result<HtmlInputElement, JsValue> {
        let wrap = el(doc, "label", label, "")?;
        let input: HtmlInputElement = doc.create_element("input")?.dyn_into()?;
        input.set_value(value);
        input.set_required(true);
        input.set_max_length(max);
        wrap.append_child(&input)?;
        wrapper.append_child(&wrap)?;
        Ok(input)
    };
    let name = input("NAME", &p.name, 48)?;
    let expression = input("EXPRESSION", &p.expression, 512)?;
    if let Some(q) = value {
        wrapper.append_child(
            el(
                doc,
                "div",
                &format!("Applied: {:.7} {}", q.value, units::dimension_label(&q.dim)),
                "resolved-value",
            )?
            .as_ref(),
        )?;
    }
    let remove = el(doc, "button", "Remove", "")?;
    remove.set_attribute("type", "button")?;
    remove.set_attribute("data-rust-remove", &p.id)?;
    wrapper.append_child(&remove)?;
    parent.append_child(&wrapper)?;
    Ok(Row {
        wrapper,
        id: p.id.clone(),
        name,
        expression,
    })
}
#[wasm_bindgen]
pub struct ParameterEditor {
    form: Element,
    click: Closure<dyn FnMut(Event)>,
    input: Closure<dyn FnMut(Event)>,
    submit: Closure<dyn FnMut(Event)>,
}
#[wasm_bindgen]
impl ParameterEditor {
    #[wasm_bindgen(constructor)]
    pub fn new(
        parent: &Element,
        input_json: &str,
        imported: bool,
        commit: Function,
        dirty: Function,
    ) -> Result<ParameterEditor, JsValue> {
        let doc = parent
            .owner_document()
            .ok_or_else(|| error("Missing document."))?;
        let parameters: Vec<units::Parameter> = serde_json::from_str(input_json).map_err(error)?;
        let values = units::parameters(&parameters).map_err(error)?;
        parent.append_child(el(&doc, "h2", "Global parameters", "")?.as_ref())?;
        parent.append_child(el(&doc,"p",if imported{"Parameters drive materials and sketch operations; the imported base STEP is unchanged."}else{"Rust unit engine · apply engineering units and equations to regenerate dependent CAD geometry."},"note")?.as_ref())?;
        let form = el(&doc, "form", "", "")?;
        let rows_parent = el(&doc, "div", "", "")?;
        form.append_child(&rows_parent)?;
        let rows = Rc::new(RefCell::new(Vec::<Row>::new()));
        for p in parameters {
            rows.borrow_mut()
                .push(row(&doc, &rows_parent, &p, values.get(&p.name))?);
        }
        let add = el(&doc, "button", "＋ Add parameter", "full")?;
        add.set_attribute("type", "button")?;
        add.set_attribute("data-rust-add", "")?;
        form.append_child(&add)?;
        let apply = el(&doc, "button", "Apply changes", "primary")?;
        apply.set_attribute("type", "submit")?;
        form.append_child(&apply)?;
        let diagnostic = el(&doc, "p", "", "callout")?;
        diagnostic.set_attribute("hidden", "")?;
        diagnostic.set_attribute("role", "alert")?;
        form.append_child(&diagnostic)?;
        parent.append_child(&form)?;
        parent.append_child(el(&doc,"p","Examples: 1.2 mm · 5 V · length + 2 mm. Celsius is a complete literal; use kelvin in compound expressions.","note")?.as_ref())?;
        let rows_click = rows.clone();
        let dirty_click = dirty.clone();
        let diagnostic_click = diagnostic.clone();
        let click = Closure::new(move |event: Event| {
            let Some(target) = event.target().and_then(|t| t.dyn_into::<Element>().ok()) else {
                return;
            };
            let action = || -> Result<(), JsValue> {
                if target.has_attribute("data-rust-add") {
                    if rows_click
                        .borrow()
                        .iter()
                        .filter(|r| r.wrapper.is_connected())
                        .count()
                        >= 64
                    {
                        return Err(error("A project supports up to 64 parameters."));
                    }
                    let id = web_sys::window()
                        .ok_or_else(|| error("Missing window."))?
                        .crypto()?
                        .random_uuid();
                    let p = units::Parameter {
                        id,
                        name: String::new(),
                        expression: String::new(),
                    };
                    rows_click
                        .borrow_mut()
                        .push(row(&doc, &rows_parent, &p, None)?);
                    dirty_click.call0(&JsValue::NULL)?;
                } else if let Some(id) = target.get_attribute("data-rust-remove")
                    && let Some(r) = rows_click.borrow().iter().find(|r| r.id == id)
                {
                    r.wrapper.remove();
                    dirty_click.call0(&JsValue::NULL)?;
                }
                Ok(())
            };
            if let Err(e) = action() {
                diagnostic_click.set_text_content(Some(&diagnostic_text(&e)));
                let _ = diagnostic_click.remove_attribute("hidden");
            }
        });
        let input = Closure::new(move |_: Event| {
            let _ = dirty.call0(&JsValue::NULL);
        });
        let submit = Closure::new(move |event: Event| {
            event.prevent_default();
            let result = || -> Result<(), JsValue> {
                let list: Vec<_> = rows
                    .borrow()
                    .iter()
                    .filter(|r| r.wrapper.is_connected())
                    .map(|r| units::Parameter {
                        id: r.id.clone(),
                        name: r.name.value().trim().into(),
                        expression: r.expression.value().trim().into(),
                    })
                    .collect();
                units::parameters(&list).map_err(error)?;
                commit.call1(&JsValue::NULL, &JsValue::from_str(&json(&list)?))?;
                Ok(())
            };
            match result() {
                Ok(()) => {
                    let _ = diagnostic.set_attribute("hidden", "");
                }
                Err(e) => {
                    diagnostic.set_text_content(Some(&diagnostic_text(&e)));
                    let _ = diagnostic.remove_attribute("hidden");
                }
            }
        });
        form.add_event_listener_with_callback("click", click.as_ref().unchecked_ref())?;
        form.add_event_listener_with_callback("input", input.as_ref().unchecked_ref())?;
        form.add_event_listener_with_callback("submit", submit.as_ref().unchecked_ref())?;
        Ok(Self {
            form,
            click,
            input,
            submit,
        })
    }
    pub fn form(&self) -> Element {
        self.form.clone()
    }
}
impl Drop for ParameterEditor {
    fn drop(&mut self) {
        let _ = self
            .form
            .remove_event_listener_with_callback("click", self.click.as_ref().unchecked_ref());
        let _ = self
            .form
            .remove_event_listener_with_callback("input", self.input.as_ref().unchecked_ref());
        let _ = self
            .form
            .remove_event_listener_with_callback("submit", self.submit.as_ref().unchecked_ref());
    }
}

#[wasm_bindgen]
pub fn solve_electrical_tetra(input: &str) -> Result<String, JsValue> {
    let q = serde_json::from_str(input).map_err(error)?;
    json(&engineering_core::electrical::solve(&q, &mut |_| {}).map_err(error)?)
}

#[wasm_bindgen]
pub fn solve_structural_tetra(input: &str) -> Result<String, JsValue> {
    let q = serde_json::from_str(input).map_err(error)?;
    json(&engineering_core::structural::solve(&q, &mut |_| {}).map_err(error)?)
}

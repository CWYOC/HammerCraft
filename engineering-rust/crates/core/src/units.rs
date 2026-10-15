//! Bounded, non-executable SI expression parser shared by native and WASM builds.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Quantity {
    pub value: f64,
    pub dim: [f64; 5],
}
impl Quantity {
    fn scalar(value: f64) -> Self {
        Self {
            value,
            dim: [0.; 5],
        }
    }
    fn checked(self) -> Result<Self, String> {
        if !self.value.is_finite() || self.dim.iter().any(|v| !v.is_finite()) {
            Err("Expression produced an invalid number (check division by zero).".into())
        } else {
            Ok(self)
        }
    }
}
pub fn same_dimension(a: &[f64; 5], b: &[f64; 5]) -> bool {
    a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-10)
}
pub fn dimension_label(dim: &[f64; 5]) -> String {
    let pieces: Vec<_> = dim
        .iter()
        .zip(["m", "kg", "s", "A", "K"])
        .filter_map(|(d, u)| {
            if *d == 0. {
                None
            } else {
                Some(if *d == 1. {
                    u.into()
                } else {
                    format!("{u}^{d}")
                })
            }
        })
        .collect();
    if pieces.is_empty() {
        "dimensionless".into()
    } else {
        pieces.join(" · ")
    }
}
fn shadowable(name: &str) -> bool {
    [
        "S", "kS", "MS", "T", "mT", "Wb", "MHz", "bar", "psi", "uF", "µF", "nF", "pF", "percent",
        "Np", "mV", "kV", "uV", "µV", "uA", "µA",
    ]
    .contains(&name)
}
fn unit(name: &str) -> Option<Quantity> {
    let (value, dim) = match name {
        "m" => (1., [1., 0., 0., 0., 0.]),
        "mm" => (1e-3, [1., 0., 0., 0., 0.]),
        "cm" => (1e-2, [1., 0., 0., 0., 0.]),
        "um" | "µm" => (1e-6, [1., 0., 0., 0., 0.]),
        "in" => (0.0254, [1., 0., 0., 0., 0.]),
        "ft" => (0.3048, [1., 0., 0., 0., 0.]),
        "kg" => (1., [0., 1., 0., 0., 0.]),
        "g" => (0.001, [0., 1., 0., 0., 0.]),
        "s" => (1., [0., 0., 1., 0., 0.]),
        "min" => (60., [0., 0., 1., 0., 0.]),
        "h" => (3600., [0., 0., 1., 0., 0.]),
        "A" => (1., [0., 0., 0., 1., 0.]),
        "mA" => (0.001, [0., 0., 0., 1., 0.]),
        "K" => (1., [0., 0., 0., 0., 1.]),
        "N" => (1., [1., 1., -2., 0., 0.]),
        "kN" => (1e3, [1., 1., -2., 0., 0.]),
        "Pa" => (1., [-1., 1., -2., 0., 0.]),
        "kPa" => (1e3, [-1., 1., -2., 0., 0.]),
        "MPa" => (1e6, [-1., 1., -2., 0., 0.]),
        "GPa" => (1e9, [-1., 1., -2., 0., 0.]),
        "bar" => (1e5, [-1., 1., -2., 0., 0.]),
        "psi" => (6894.757293168, [-1., 1., -2., 0., 0.]),
        "J" => (1., [2., 1., -2., 0., 0.]),
        "W" => (1., [2., 1., -3., 0., 0.]),
        "kW" => (1e3, [2., 1., -3., 0., 0.]),
        "V" => (1., [2., 1., -3., -1., 0.]),
        "mV" => (1e-3, [2., 1., -3., -1., 0.]),
        "kV" => (1e3, [2., 1., -3., -1., 0.]),
        "uV" | "µV" => (1e-6, [2., 1., -3., -1., 0.]),
        "uA" | "µA" => (1e-6, [0., 0., 0., 1., 0.]),
        "ohm" => (1., [2., 1., -3., -2., 0.]),
        "Hz" => (1., [0., 0., -1., 0., 0.]),
        "kHz" => (1e3, [0., 0., -1., 0., 0.]),
        "MHz" => (1e6, [0., 0., -1., 0., 0.]),
        "F" => (1., [-2., -1., 4., 2., 0.]),
        "uF" | "µF" => (1e-6, [-2., -1., 4., 2., 0.]),
        "nF" => (1e-9, [-2., -1., 4., 2., 0.]),
        "pF" => (1e-12, [-2., -1., 4., 2., 0.]),
        "H" => (1., [2., 1., -2., -2., 0.]),
        "S" => (1., [-2., -1., 3., 2., 0.]),
        "kS" => (1e3, [-2., -1., 3., 2., 0.]),
        "MS" => (1e6, [-2., -1., 3., 2., 0.]),
        "T" => (1., [0., 1., -2., -1., 0.]),
        "mT" => (1e-3, [0., 1., -2., -1., 0.]),
        "Wb" => (1., [2., 1., -2., -1., 0.]),
        "rad" | "Np" => (1., [0.; 5]),
        "deg" => (std::f64::consts::PI / 180., [0.; 5]),
        "pi" => (std::f64::consts::PI, [0.; 5]),
        "percent" => (0.01, [0.; 5]),
        _ => return None,
    };
    Some(Quantity { value, dim })
}
#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    Name(String),
    Op(char),
}
fn tokenize(text: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    let mut tokens = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() || c == '.' {
            let start = i;
            i += 1;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            if c != '.' && i < chars.len() && chars[i] == '.' {
                i += 1;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
            }
            if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') {
                let before = i;
                i += 1;
                if i < chars.len() && (chars[i] == '+' || chars[i] == '-') {
                    i += 1;
                }
                let digits = i;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
                if i == digits {
                    i = before;
                }
            }
            let s: String = chars[start..i].iter().collect();
            let v = s.parse::<f64>().map_err(|_| "Invalid number.")?;
            if !v.is_finite() {
                return Err("Expression produced an invalid number.".into());
            }
            tokens.push(Token::Number(v));
        } else if c.is_ascii_alphabetic() || c == '_' || c == 'µ' {
            let start = i;
            i += 1;
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == 'µ')
            {
                i += 1;
            }
            tokens.push(Token::Name(chars[start..i].iter().collect()));
        } else if "()+-*/^".contains(c) {
            tokens.push(Token::Op(c));
            i += 1;
        } else {
            return Err(format!(
                "Unexpected character at position {}. Use K in compound temperature expressions.",
                i + 1
            ));
        }
        if tokens.len() > 160 {
            return Err("Expression is too complex.".into());
        }
    }
    Ok(tokens)
}
struct Parser<'a, F: FnMut(&str) -> Result<Option<Quantity>, String>> {
    tokens: Vec<Token>,
    pos: usize,
    resolve: &'a mut F,
}
impl<F: FnMut(&str) -> Result<Option<Quantity>, String>> Parser<'_, F> {
    fn op(&self, c: char) -> bool {
        self.tokens.get(self.pos) == Some(&Token::Op(c))
    }
    fn atom(&mut self) -> Result<Quantity, String> {
        let token = self.tokens.get(self.pos).cloned();
        self.pos += 1;
        match token {
            Some(Token::Number(v)) => Ok(Quantity::scalar(v)),
            Some(Token::Name(n)) => {
                let value = if shadowable(&n) {
                    (self.resolve)(&n)?.or_else(|| unit(&n))
                } else {
                    match unit(&n) {
                        Some(u) => Some(u),
                        None => (self.resolve)(&n)?,
                    }
                };
                value
                    .ok_or_else(|| format!("Unknown parameter or unit: {n}."))
                    .and_then(Quantity::checked)
            }
            Some(Token::Op('(')) => {
                let q = self.sum()?;
                if !self.op(')') {
                    return Err("Missing closing parenthesis.".into());
                }
                self.pos += 1;
                Ok(q)
            }
            _ => Err("Expected a number, parameter, unit, or parenthesis.".into()),
        }
    }
    fn power(&mut self) -> Result<Quantity, String> {
        let mut l = self.atom()?;
        if self.op('^') {
            self.pos += 1;
            let r = self.unary()?;
            if !same_dimension(&r.dim, &[0.; 5]) || r.value.abs() > 12. {
                return Err("Exponents must be dimensionless and between −12 and 12.".into());
            }
            l.value = l.value.powf(r.value);
            for d in &mut l.dim {
                *d *= r.value;
            }
        }
        l.checked()
    }
    fn unary(&mut self) -> Result<Quantity, String> {
        if self.op('+') || self.op('-') {
            let sign = if self.op('-') { -1. } else { 1. };
            self.pos += 1;
            let mut q = self.unary()?;
            q.value *= sign;
            Ok(q)
        } else {
            self.power()
        }
    }
    fn product(&mut self) -> Result<Quantity, String> {
        let mut l = self.unary()?;
        while self.op('*')
            || self.op('/')
            || self.op('(')
            || matches!(self.tokens.get(self.pos), Some(Token::Name(_)))
        {
            let divide = self.op('/');
            if self.op('*') || divide {
                self.pos += 1;
            }
            let r = self.unary()?;
            l.value = if divide {
                l.value / r.value
            } else {
                l.value * r.value
            };
            for i in 0..5 {
                l.dim[i] += r.dim[i] * if divide { -1. } else { 1. };
            }
            l = l.checked()?;
        }
        Ok(l)
    }
    fn sum(&mut self) -> Result<Quantity, String> {
        let mut l = self.product()?;
        while self.op('+') || self.op('-') {
            let sign = if self.op('-') { -1. } else { 1. };
            self.pos += 1;
            let r = self.product()?;
            if !same_dimension(&l.dim, &r.dim) {
                return Err(format!(
                    "Incompatible dimensions: {} and {}.",
                    dimension_label(&l.dim),
                    dimension_label(&r.dim)
                ));
            }
            l.value += sign * r.value;
            l = l.checked()?;
        }
        Ok(l)
    }
}
pub fn evaluate(
    expression: &str,
    resolve: &mut impl FnMut(&str) -> Result<Option<Quantity>, String>,
) -> Result<Quantity, String> {
    if expression.trim().is_empty() || expression.chars().count() > 512 {
        return Err("Enter an expression of 1–512 characters.".into());
    }
    let trimmed = expression.trim();
    let lower = trimmed.to_lowercase();
    for suffix in ["degc", "°c"] {
        if lower.ends_with(suffix) {
            let prefix = trimmed[..trimmed.len() - suffix.len()].trim();
            if !prefix.is_empty()
                && prefix
                    .chars()
                    .all(|c| c.is_ascii_digit() || "+-.eE".contains(c))
                && let Ok(value) = prefix.parse::<f64>()
            {
                let value = value + 273.15;
                if !value.is_finite() || value < 0. {
                    return Err("Temperature must be at or above absolute zero.".into());
                }
                return Ok(Quantity {
                    value,
                    dim: [0., 0., 0., 0., 1.],
                });
            }
        }
    }
    let mut parser = Parser {
        tokens: tokenize(expression)?,
        pos: 0,
        resolve,
    };
    let value = parser.sum()?;
    if parser.pos != parser.tokens.len() {
        return Err("Unexpected token after expression.".into());
    }
    value.checked()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Parameter {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub expression: String,
}
pub fn parameters(list: &[Parameter]) -> Result<BTreeMap<String, Quantity>, String> {
    if list.len() > 64 {
        return Err("A project supports up to 64 parameters.".into());
    }
    let mut definitions = BTreeMap::new();
    for p in list {
        let mut chars = p.name.chars();
        if p.name.len() > 48
            || !chars
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
            || unit(&p.name).is_some() && !shadowable(&p.name)
            || ["degC", "__proto__", "constructor", "prototype"].contains(&p.name.as_str())
        {
            return Err(
                "Parameter names must be unique identifiers and cannot be unit names.".into(),
            );
        }
        if definitions
            .insert(p.name.clone(), p.expression.clone())
            .is_some()
        {
            return Err(format!("Duplicate parameter: {}.", p.name));
        }
    }
    fn resolve(
        name: &str,
        defs: &BTreeMap<String, String>,
        values: &mut BTreeMap<String, Quantity>,
        visiting: &mut BTreeSet<String>,
    ) -> Result<Option<Quantity>, String> {
        if let Some(q) = values.get(name) {
            return Ok(Some(q.clone()));
        }
        let Some(expression) = defs.get(name) else {
            return Ok(None);
        };
        if !visiting.insert(name.into()) {
            return Err(format!("Circular parameter dependency at {name}."));
        }
        let q = evaluate(expression, &mut |n| resolve(n, defs, values, visiting))
            .map_err(|e| format!("{name}: {e}"))?;
        visiting.remove(name);
        values.insert(name.into(), q.clone());
        Ok(Some(q))
    }
    let mut values = BTreeMap::new();
    let mut visiting = BTreeSet::new();
    for name in definitions.keys() {
        resolve(name, &definitions, &mut values, &mut visiting)?;
    }
    Ok(values)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn eval(s: &str) -> Quantity {
        evaluate(s, &mut |_| Ok(None)).unwrap()
    }
    #[test]
    fn conversions_precedence_and_dimensions() {
        assert_eq!(eval("-2^2").value, -4.);
        assert!((eval("1 g/cm^3").value - 1000.).abs() < 1e-10);
        assert_eq!(eval("-20 °C").value, 253.14999999999998);
        assert_eq!(eval("5 V * 2 A").dim, eval("1 W").dim);
        assert!((eval("90 deg").value - std::f64::consts::PI / 2.).abs() < 1e-12);
    }
    #[test]
    fn unsafe_and_invalid_inputs_fail() {
        for s in [
            "1 m + 1 s",
            "1/0",
            "2^13",
            "alert(1)",
            "-274 degC",
            "1;2",
            "()",
            "NaN",
            "1e999",
            "2 3",
            "1 m^pi^pi",
        ] {
            assert!(evaluate(s, &mut |_| Ok(None)).is_err(), "{s}");
        }
    }
    #[test]
    fn dependencies_and_unit_shadowing() {
        let p:Vec<Parameter>=serde_json::from_str(r#"[{"name":"T","expression":"80 degC"},{"name":"wall","expression":"1.2 mm"},{"name":"outer","expression":"wall*2 + 8 mm"}]"#).unwrap();
        let v = parameters(&p).unwrap();
        assert!((v["outer"].value - 0.0104).abs() < 1e-14);
        assert_eq!(v["T"].value, 353.15);
        let cycle: Vec<Parameter> = serde_json::from_str(
            r#"[{"name":"a","expression":"b"},{"name":"b","expression":"a"}]"#,
        )
        .unwrap();
        assert!(parameters(&cycle).unwrap_err().contains("Circular"));
    }
}
